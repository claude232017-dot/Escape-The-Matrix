import { classifyFailure, sqlstateOf, type FailureClass } from '@/lib/sqlstate';
import { readScoped, writeScoped, type StorageLike } from '@/lib/local-state';

/**
 * A durable outbox for writes that must survive losing the network.
 *
 * Men will report from trains, gyms and car parks. The requirements this implements, from §3.10:
 *
 *  - **Coalescing, latest-wins, one slot per key.** Ten edits to one day produce one queued
 *    upsert, not ten replays.
 *  - **Persisted**, so closing the tab does not lose the entry.
 *  - **Classified by SQLSTATE**, never by message text — see @/lib/sqlstate.
 *  - **Honest state.** "Held on this device" is true and useful. A green tick is a lie, and a man
 *    must never believe his SITREP was filed when it was not.
 *
 * The queue itself is a plain value and every operation on it is pure. Nothing here touches the
 * network, a timer or the DOM: the driver takes a `send` function and a clock. That is what makes
 * the retry and coalescing rules testable without pretending to be offline.
 */

export interface OutboxEntry<T = unknown> {
  /** The coalescing key. One slot per key; a second enqueue replaces the payload. */
  key: string;
  payload: T;
  /** When this *version* of the payload was queued. Updated on coalesce. */
  queuedAt: string;
  /** When the key was first queued, kept across coalescing so "how long held" is truthful. */
  firstQueuedAt: string;
  attempts: number;
  /** Earliest instant a retry may be attempted. Null means "now". */
  nextAttemptAt: string | null;
  lastFailure: {
    sqlstate: string | null;
    message: string;
    classification: FailureClass;
    at: string;
  } | null;
  /**
   * Set once the entry will never be retried.
   *
   * Kept in the queue rather than deleted, because the man has to be told. Silently dropping a
   * rejected write is the same failure as retrying it for ever: he believes it was filed.
   */
  rejectedAt: string | null;
}

export interface Outbox {
  entries: OutboxEntry[];
}

export const EMPTY_OUTBOX: Outbox = { entries: [] };

/**
 * How many attempts an `unknown` failure gets before it is surfaced.
 *
 * Bounded on purpose. An unrecognised error retried for ever is the exact silence §3.10 forbids;
 * six attempts with capped backoff spans roughly ten minutes, which covers a tunnel and does not
 * cover a bug.
 */
export const UNKNOWN_ATTEMPT_LIMIT = 6;

/** Transient failures retry indefinitely — the network really may be gone for hours. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_BACKOFF_MS = 60_000;

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? MAX_BACKOFF_MS;
}

/**
 * Queue a write, replacing any existing entry with the same key.
 *
 * Latest-wins: the payload is the current truth about that key, so an earlier version has no
 * value. Attempts and failure state are cleared, because a new payload deserves a fresh attempt —
 * a previous rejection was about the old content.
 */
export function enqueue<T>(outbox: Outbox, key: string, payload: T, now: Date): Outbox {
  const existing = outbox.entries.find((entry) => entry.key === key);
  const entry: OutboxEntry<T> = {
    key,
    payload,
    queuedAt: now.toISOString(),
    firstQueuedAt: existing?.firstQueuedAt ?? now.toISOString(),
    attempts: 0,
    nextAttemptAt: null,
    lastFailure: null,
    rejectedAt: null,
  };
  return {
    entries: existing
      ? outbox.entries.map((candidate) => (candidate.key === key ? entry : candidate))
      : [...outbox.entries, entry],
  };
}

export function remove(outbox: Outbox, key: string): Outbox {
  return { entries: outbox.entries.filter((entry) => entry.key !== key) };
}

/** Entries eligible for an attempt right now: not rejected, and past their backoff. */
export function dueEntries(outbox: Outbox, now: Date): OutboxEntry[] {
  return outbox.entries.filter(
    (entry) =>
      entry.rejectedAt === null &&
      (entry.nextAttemptAt === null || new Date(entry.nextAttemptAt) <= now),
  );
}

function recordFailure(entry: OutboxEntry, cause: unknown, now: Date): OutboxEntry {
  const classification = classifyFailure(cause);
  const attempts = entry.attempts + 1;
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  const failure = {
    sqlstate: sqlstateOf(cause),
    message,
    classification,
    at: now.toISOString(),
  };

  // Permanent immediately, unknown once it has had its bounded run. Transient never rejects: the
  // network may genuinely be gone for hours, and the entry is safe on the device meanwhile.
  const rejected =
    classification === 'permanent' ||
    (classification === 'unknown' && attempts >= UNKNOWN_ATTEMPT_LIMIT);

  return {
    ...entry,
    attempts,
    lastFailure: failure,
    rejectedAt: rejected ? now.toISOString() : null,
    nextAttemptAt: rejected
      ? null
      : new Date(now.getTime() + backoffFor(attempts - 1)).toISOString(),
  };
}

export interface FlushOutcome {
  outbox: Outbox;
  sent: string[];
  /** Keys that failed but will be tried again. */
  retrying: string[];
  /** Keys that will never be tried again and must be surfaced to the person. */
  rejected: string[];
}

/**
 * Attempt every due entry once.
 *
 * Sequential rather than parallel, deliberately: two writes coalesced onto different keys may
 * still touch the same row (a SITREP and its protocol results), and firing them together turns a
 * predictable order into a race whose failure mode depends on timing.
 *
 * `send` is injected so this is testable without a network, and so the same driver serves the
 * Forge and the Ledger.
 */
export async function flush(
  outbox: Outbox,
  send: (entry: OutboxEntry) => Promise<void>,
  now: Date = new Date(),
): Promise<FlushOutcome> {
  const due = dueEntries(outbox, now);
  let next = outbox;
  const sent: string[] = [];
  const retrying: string[] = [];
  const rejected: string[] = [];

  for (const entry of due) {
    // Re-read from the working copy: a coalesce could have replaced the payload since `due` was
    // computed, and sending a stale payload would undo the newer edit.
    const current = next.entries.find((candidate) => candidate.key === entry.key);
    if (!current || current.rejectedAt !== null) continue;

    try {
      await send(current);
      next = remove(next, current.key);
      sent.push(current.key);
    } catch (cause) {
      const updated = recordFailure(current, cause, now);
      next = {
        entries: next.entries.map((candidate) =>
          candidate.key === current.key ? updated : candidate,
        ),
      };
      if (updated.rejectedAt) rejected.push(current.key);
      else retrying.push(current.key);
    }
  }

  return { outbox: next, sent, retrying, rejected };
}

export interface OutboxStatus {
  pending: number;
  rejected: number;
  /** When the oldest still-unsent entry was first queued. */
  oldestFirstQueuedAt: string | null;
  state: 'empty' | 'held' | 'rejected';
}

export function statusOf(outbox: Outbox): OutboxStatus {
  const pending = outbox.entries.filter((entry) => entry.rejectedAt === null);
  const rejected = outbox.entries.filter((entry) => entry.rejectedAt !== null);
  const oldest = pending
    .map((entry) => entry.firstQueuedAt)
    .sort()
    .at(0);

  return {
    pending: pending.length,
    rejected: rejected.length,
    oldestFirstQueuedAt: oldest ?? null,
    // Rejection outranks held: something needs the person's attention, and a count of pending
    // items would bury it.
    state: rejected.length > 0 ? 'rejected' : pending.length > 0 ? 'held' : 'empty',
  };
}

/**
 * Wording for the queue's state.
 *
 * The rule §3.10 states, made concrete: **never claim a write reached the server when it has
 * not.** "Held on this device" is true. "Saved" is not, and a tick is worse than either, because
 * a man who believes his SITREP is filed does not file it again.
 */
export function describeStatus(status: OutboxStatus): string {
  if (status.state === 'rejected') {
    return status.rejected === 1
      ? 'One entry was refused and needs your attention.'
      : `${status.rejected} entries were refused and need your attention.`;
  }
  if (status.state === 'held') {
    return status.pending === 1
      ? 'Held on this device — not yet sent.'
      : `${status.pending} entries held on this device — not yet sent.`;
  }
  return 'Everything is on the server.';
}

/**
 * Persistence, scoped to one member.
 *
 * Keyed under his namespace so sign-out clears it (§3.8). If it survived his session it would
 * flush under the next person's, RLS would reject it, and they would be shown a stranger's error.
 */
const STORAGE_NAME = 'outbox';

export function loadOutbox(storage: StorageLike, userId: string): Outbox {
  const stored = readScoped<Outbox>(storage, userId, STORAGE_NAME);
  // A shape that does not match is discarded rather than trusted: a half-written or
  // older-format value must not be able to stop the app from starting.
  if (!stored || !Array.isArray(stored.entries)) return EMPTY_OUTBOX;
  const entries = stored.entries.filter(
    (entry): entry is OutboxEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as OutboxEntry).key === 'string' &&
      typeof (entry as OutboxEntry).attempts === 'number',
  );
  return { entries };
}

/**
 * Persist, returning whether it actually landed.
 *
 * `false` means the quota is exhausted and the write is **not** held on this device. The caller
 * must say so rather than showing the usual reassurance — this is the one place where a
 * comforting message would be an outright lie.
 */
export function saveOutbox(storage: StorageLike, userId: string, outbox: Outbox): boolean {
  return writeScoped(storage, userId, STORAGE_NAME, outbox);
}
