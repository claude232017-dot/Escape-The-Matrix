import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  EMPTY_OUTBOX,
  describeStatus,
  dueEntries,
  enqueue,
  flush,
  loadOutbox,
  saveOutbox,
  statusOf,
  type Outbox,
  type OutboxEntry,
  type OutboxStatus,
} from '@/lib/outbox';
import type { StorageLike } from '@/lib/local-state';

/**
 * The outbox, bound to React.
 *
 * All of the rules live in @/lib/outbox as pure functions; what is here is the part that cannot
 * be: when to try again, and where the queue is kept between page loads. §3.10 names three wake
 * points — mount, `online`, `visibilitychange` — and this adds a fourth, a timer at the earliest
 * `nextAttemptAt`, because without it a backoff of up to a minute means an entry waits for the man
 * to switch tabs. A backoff nothing ever fires is decoration.
 *
 * **Nothing is attempted while the device reports itself offline.** Not an optimisation: an
 * attempt made with no network burns an entry's attempt budget on a failure we already knew
 * about, and the `unknown` budget is bounded on purpose. A man in a car park for half an hour must
 * come back to a queue that is still trying, not one that gave up ten minutes in.
 *
 * Modelled as an **external store** rather than as React state. The queue lives in localStorage,
 * which is exactly what `useSyncExternalStore` is for, and it removes the failure mode of the
 * obvious alternative: a ref for the current value plus state for rendering, where the two drift
 * and a wake handler registered on mount coalesces onto a queue three versions old.
 */

export type SendFn = (entry: OutboxEntry) => Promise<void>;

export interface QueueOutcome {
  /** It reached the server. */
  sent: boolean;
  /** It did not reach the server but is safely on this device and will be retried. */
  held: boolean;
  /** It was refused and will never be retried. The person has to be told. */
  refused: boolean;
  /**
   * The device would not store it **and** it did not send.
   *
   * The one state where the usual reassurance is a lie: the report exists only in this tab's
   * memory, and closing the tab loses it.
   */
  lost: boolean;
  /** The failure behind `held`, `refused` or `lost`, for display. */
  failure: OutboxEntry['lastFailure'];
}

interface OutboxSnapshot {
  outbox: Outbox;
  status: OutboxStatus;
  /**
   * Whether the queue actually reached this device's storage.
   *
   * False means the quota is exhausted or storage is unavailable, and any pending entry exists
   * only in this tab's memory. Callers must say so instead of "held on this device" — see
   * `describeQueue`, which is the only sanctioned way to word it.
   */
  persisted: boolean;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * One member's queue, as a subscribable store.
 *
 * Scoped to a userId: switching accounts on a shared device constructs a new store, so this
 * member's session never adopts the previous member's unsent work. RLS would reject it and he
 * would be shown a stranger's error about work he never did.
 */
class OutboxStore {
  private snapshot: OutboxSnapshot;
  private readonly listeners = new Set<() => void>();
  private send: SendFn | null = null;
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Declared as fields rather than constructor parameter properties: `erasableSyntaxOnly` in
  // tsconfig rejects the shorthand, because it is syntax that emits code rather than being erased.
  private readonly storage: StorageLike | null;
  private readonly userId: string;

  constructor(storage: StorageLike | null, userId: string) {
    this.storage = storage;
    this.userId = userId;
    const outbox = storage ? loadOutbox(storage, userId) : EMPTY_OUTBOX;
    this.snapshot = { outbox, status: statusOf(outbox), persisted: storage !== null };
  }

  /** Stable identity, and a cached snapshot — React re-renders forever without both. */
  readonly getSnapshot = (): OutboxSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setSend(send: SendFn): void {
    this.send = send;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.send = null;
  }

  entryFor(key: string): OutboxEntry | undefined {
    return this.snapshot.outbox.entries.find((entry) => entry.key === key);
  }

  discard(key: string): void {
    this.commit({
      entries: this.snapshot.outbox.entries.filter((entry) => entry.key !== key),
    });
  }

  async flush(): Promise<void> {
    if (this.flushing || this.send === null) return;
    if (isOffline()) return;
    if (dueEntries(this.snapshot.outbox, new Date()).length === 0) return;

    const send = this.send;
    this.flushing = true;
    try {
      const outcome = await flush(this.snapshot.outbox, send);
      this.commit(outcome.outbox);
      this.rearm();
    } finally {
      this.flushing = false;
    }
  }

  async queue(key: string, payload: unknown): Promise<QueueOutcome> {
    const stored = this.commit(enqueue(this.snapshot.outbox, key, payload, new Date()));

    // Attempted even when the device refused to store it: if the send succeeds nothing was ever
    // at risk, and reporting `lost` before trying would be pessimistic to the point of wrong.
    await this.flush();

    const entry = this.entryFor(key);
    if (!entry) return { sent: true, held: false, refused: false, lost: false, failure: null };
    if (entry.rejectedAt !== null) {
      return { sent: false, held: false, refused: true, lost: false, failure: entry.lastFailure };
    }
    return { sent: false, held: stored, refused: false, lost: !stored, failure: entry.lastFailure };
  }

  private commit(outbox: Outbox): boolean {
    const persisted = this.storage ? saveOutbox(this.storage, this.userId, outbox) : false;
    this.snapshot = { outbox, status: statusOf(outbox), persisted };
    for (const listener of this.listeners) listener();
    return persisted;
  }

  /** Wake again when the earliest backoff expires. */
  private rearm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;

    const waits = this.snapshot.outbox.entries
      .filter((entry) => entry.rejectedAt === null && entry.nextAttemptAt !== null)
      .map((entry) => new Date(entry.nextAttemptAt as string).getTime() - Date.now());
    if (waits.length === 0) return;

    // A small margin past the deadline, so the timer cannot fire a millisecond early and find
    // nothing due — which would silently drop the wake and leave the entry waiting for a tab
    // switch, the exact failure the timer exists to prevent.
    const soonest = Math.max(0, Math.min(...waits)) + 50;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, soonest);
  }
}

export interface OutboxHandle {
  status: OutboxStatus;
  persisted: boolean;
  /** Queue a write and immediately try to send it. */
  queue: (key: string, payload: unknown) => Promise<QueueOutcome>;
  flushNow: () => Promise<void>;
  entryFor: (key: string) => OutboxEntry | undefined;
  /** Forget a refused entry, once the person has been shown it. */
  discard: (key: string) => void;
}

/**
 * Wording for the queue, including the case @/lib/outbox cannot know about.
 *
 * `describeStatus` handles everything except "this device would not store it", which is a property
 * of the browser rather than of the queue. Composed here rather than folded into `OutboxStatus`
 * because the two are independently true: a pending entry that was persisted and a pending entry
 * that was not are the same queue state and completely different promises.
 */
export function describeQueue(handle: Pick<OutboxHandle, 'status' | 'persisted'>): string {
  if (!handle.persisted && handle.status.pending > 0) {
    return handle.status.pending === 1
      ? 'This device would not store it. It is only in this tab — do not close the tab until it sends.'
      : `This device would not store ${handle.status.pending} entries. They are only in this tab — do not close the tab until they send.`;
  }
  return describeStatus(handle.status);
}

function defaultStorage(): StorageLike | null {
  // Reading localStorage throws outright in some privacy configurations, so this is a probe rather
  // than a feature check. A null storage degrades to an in-memory queue, reported honestly by
  // `persisted` rather than pretended away.
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function useOutbox(
  userId: string,
  send: SendFn,
  storage: StorageLike | null = defaultStorage(),
): OutboxHandle {
  const store = useMemo(() => new OutboxStore(storage, userId), [storage, userId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // `send` closes over component state and so changes identity; the store holds an indirection to
  // the latest one rather than being rebuilt, which would discard the queue on every render.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    store.setSend((entry) => sendRef.current(entry));
    const wake = () => void store.flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };

    wake();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', onVisible);
      store.dispose();
    };
  }, [store]);

  const queue = useCallback(
    (key: string, payload: unknown) => store.queue(key, payload),
    [store],
  );
  const flushNow = useCallback(() => store.flush(), [store]);
  const entryFor = useCallback((key: string) => store.entryFor(key), [store]);
  const discard = useCallback((key: string) => store.discard(key), [store]);

  return {
    status: snapshot.status,
    persisted: snapshot.persisted,
    queue,
    flushNow,
    entryFor,
    discard,
  };
}
