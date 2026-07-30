import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffFor,
  describeStatus,
  dueEntries,
  EMPTY_OUTBOX,
  enqueue,
  flush,
  loadOutbox,
  remove,
  saveOutbox,
  statusOf,
  UNKNOWN_ATTEMPT_LIMIT,
  type Outbox,
  type OutboxEntry,
} from '@/lib/outbox';
import { scopedKey, type StorageLike } from '@/lib/local-state';

const T0 = new Date('2026-07-30T10:00:00Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

/** A rejection carrying a real SQLSTATE, as PostgREST would deliver it. */
const pgError = (code: string, message = 'database said no') => Object.assign(new Error(message), { code });

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe('coalescing — one slot per key, latest wins', () => {
  it('turns ten edits to one day into one queued write', () => {
    // The stated requirement. Ten replays would each be an upsert of a superseded payload.
    let outbox: Outbox = EMPTY_OUTBOX;
    for (let i = 1; i <= 10; i += 1) {
      outbox = enqueue(outbox, 'sitrep:2026-07-30', { version: i }, later(i * 100));
    }
    expect(outbox.entries).toHaveLength(1);
    expect(outbox.entries[0]?.payload).toEqual({ version: 10 });
  });

  it('keeps separate keys separate', () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'sitrep:2026-07-29', { a: 1 }, T0);
    outbox = enqueue(outbox, 'sitrep:2026-07-30', { b: 2 }, T0);
    expect(outbox.entries.map((e) => e.key)).toEqual(['sitrep:2026-07-29', 'sitrep:2026-07-30']);
  });

  it('preserves how long the key has been held, across coalescing', () => {
    // "Held for two hours" must stay true when he edits it again — otherwise the display resets
    // and a stuck queue looks fresh for ever.
    let outbox = enqueue(EMPTY_OUTBOX, 'k', { v: 1 }, T0);
    outbox = enqueue(outbox, 'k', { v: 2 }, later(7_200_000));
    expect(outbox.entries[0]?.firstQueuedAt).toBe(T0.toISOString());
    expect(outbox.entries[0]?.queuedAt).toBe(later(7_200_000).toISOString());
  });

  it('clears a previous rejection, because a new payload deserves a fresh attempt', async () => {
    // The old rejection was about the old content. If it persisted, correcting a bad value could
    // never be sent.
    let outbox = enqueue(EMPTY_OUTBOX, 'k', { text: 'x'.repeat(200) }, T0);
    ({ outbox } = await flush(outbox, () => Promise.reject(pgError('22001')), T0));
    expect(outbox.entries[0]?.rejectedAt).not.toBeNull();

    outbox = enqueue(outbox, 'k', { text: 'short' }, later(1000));
    expect(outbox.entries[0]?.rejectedAt).toBeNull();
    expect(outbox.entries[0]?.attempts).toBe(0);
    expect(outbox.entries[0]?.lastFailure).toBeNull();
  });

  it('does not send a payload that was superseded mid-flush', async () => {
    // A coalesce landing between computing the due list and sending would otherwise push the
    // stale version and silently undo the newer edit.
    let outbox = enqueue(EMPTY_OUTBOX, 'a', { v: 1 }, T0);
    outbox = enqueue(outbox, 'b', { v: 1 }, T0);
    const seen: unknown[] = [];
    const result = await flush(
      outbox,
      (entry) => {
        seen.push(entry.payload);
        return Promise.resolve();
      },
      T0,
    );
    expect(seen).toEqual([{ v: 1 }, { v: 1 }]);
    expect(result.sent).toEqual(['a', 'b']);
  });
});

describe('a permanent rejection is surfaced, not retried for ever', () => {
  it('rejects immediately on a permanent SQLSTATE', async () => {
    const outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    const result = await flush(outbox, () => Promise.reject(pgError('42501')), T0);
    expect(result.rejected).toEqual(['k']);
    expect(result.retrying).toEqual([]);
    expect(result.outbox.entries[0]?.lastFailure?.classification).toBe('permanent');
  });

  it('keeps the rejected entry rather than dropping it', async () => {
    // Dropping it is the same failure as retrying for ever: he believes it was filed.
    const outbox = enqueue(EMPTY_OUTBOX, 'k', { sitrep: true }, T0);
    const result = await flush(outbox, () => Promise.reject(pgError('23514')), T0);
    expect(result.outbox.entries).toHaveLength(1);
    expect(result.outbox.entries[0]?.payload).toEqual({ sitrep: true });
  });

  it('never attempts a rejected entry again', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    ({ outbox } = await flush(outbox, () => Promise.reject(pgError('42501')), T0));

    const send = vi.fn(() => Promise.resolve());
    // Far in the future, well past any backoff.
    const second = await flush(outbox, send, later(86_400_000));
    expect(send).not.toHaveBeenCalled();
    expect(second.sent).toEqual([]);
    expect(dueEntries(outbox, later(86_400_000))).toEqual([]);
  });

  it('records the SQLSTATE, so the cause can be diagnosed later', async () => {
    const outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    const result = await flush(outbox, () => Promise.reject(pgError('23505', 'duplicate key')), T0);
    expect(result.outbox.entries[0]?.lastFailure).toMatchObject({
      sqlstate: '23505',
      message: 'duplicate key',
      classification: 'permanent',
    });
  });
});

describe('a transient failure retries with capped backoff', () => {
  it('retries indefinitely — the network may be gone for hours', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const at = later(attempt * 120_000);
      const result = await flush(outbox, () => Promise.reject(pgError('08006')), at);
      outbox = result.outbox;
      expect(outbox.entries[0]?.rejectedAt, `attempt ${attempt}`).toBeNull();
    }
    expect(outbox.entries[0]?.attempts).toBe(20);
  });

  it('waits before the next attempt', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    ({ outbox } = await flush(outbox, () => Promise.reject(pgError('08006')), T0));

    const send = vi.fn(() => Promise.resolve());
    // Immediately after failing, it is not due.
    await flush(outbox, send, later(100));
    expect(send).not.toHaveBeenCalled();

    // After the backoff, it is.
    await flush(outbox, send, later(backoffFor(0) + 1));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('caps the backoff so a long outage does not become an hour-long gap', () => {
    expect(backoffFor(0)).toBe(1_000);
    expect(backoffFor(3)).toBe(15_000);
    for (const attempts of [10, 50, 1000]) {
      expect(backoffFor(attempts)).toBeLessThanOrEqual(60_000);
    }
    expect(backoffFor(1000)).toBe(60_000);
  });

  it('succeeds once the network returns, and the entry leaves the queue', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'k', { sitrep: true }, T0);
    ({ outbox } = await flush(outbox, () => Promise.reject(pgError('08006')), T0));
    expect(statusOf(outbox).state).toBe('held');

    const result = await flush(outbox, () => Promise.resolve(), later(60_000));
    expect(result.sent).toEqual(['k']);
    expect(result.outbox.entries).toEqual([]);
    expect(statusOf(result.outbox).state).toBe('empty');
  });
});

describe('an unknown failure retries, but not for ever', () => {
  it('gives up after the attempt limit and surfaces it', async () => {
    // A network error has no SQLSTATE, so it lands here. Bounded because an unrecognised error
    // retried for ever loses the report and hides that fact.
    let outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    for (let attempt = 0; attempt < UNKNOWN_ATTEMPT_LIMIT; attempt += 1) {
      const result = await flush(
        outbox,
        () => Promise.reject(new TypeError('Failed to fetch')),
        later(attempt * 120_000),
      );
      outbox = result.outbox;
    }
    expect(outbox.entries[0]?.attempts).toBe(UNKNOWN_ATTEMPT_LIMIT);
    expect(outbox.entries[0]?.rejectedAt).not.toBeNull();
    expect(statusOf(outbox).state).toBe('rejected');
  });

  it('is still pending one attempt short of the limit', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    for (let attempt = 0; attempt < UNKNOWN_ATTEMPT_LIMIT - 1; attempt += 1) {
      const result = await flush(
        outbox,
        () => Promise.reject(new TypeError('Failed to fetch')),
        later(attempt * 120_000),
      );
      outbox = result.outbox;
    }
    expect(outbox.entries[0]?.rejectedAt).toBeNull();
    expect(statusOf(outbox).state).toBe('held');
  });
});

describe('the queue survives being closed', () => {
  it('round-trips through storage', () => {
    const outbox = enqueue(EMPTY_OUTBOX, 'sitrep:2026-07-30', { protocols: ['a', 'b'] }, T0);
    expect(saveOutbox(storage, 'alice', outbox)).toBe(true);
    expect(loadOutbox(storage, 'alice')).toEqual(outbox);
  });

  it('is scoped to the member, so sign-out clears it', () => {
    // §3.8. A queue that outlives its owner's session flushes under the next one, RLS rejects it,
    // and a stranger is shown an error about work they never did.
    saveOutbox(storage, 'alice', enqueue(EMPTY_OUTBOX, 'k', {}, T0));
    expect(storage.getItem(scopedKey('alice', 'outbox'))).not.toBeNull();
    expect(loadOutbox(storage, 'bob').entries).toEqual([]);
  });

  it('returns an empty queue rather than throwing on a corrupt value', () => {
    // A half-written value must not be able to stop the app from starting.
    storage.seed(scopedKey('alice', 'outbox'), '{not json');
    expect(loadOutbox(storage, 'alice')).toEqual(EMPTY_OUTBOX);
  });

  it('discards entries of the wrong shape rather than trusting them', () => {
    storage.seed(
      scopedKey('alice', 'outbox'),
      JSON.stringify({ entries: [{ key: 'good', attempts: 0 }, { nonsense: true }, null] }),
    );
    expect(loadOutbox(storage, 'alice').entries).toHaveLength(1);
  });

  it('reports a failed save, because that means it is NOT held on this device', () => {
    // The one place a reassuring message would be an outright lie.
    storage.failWrites = true;
    expect(saveOutbox(storage, 'alice', enqueue(EMPTY_OUTBOX, 'k', {}, T0))).toBe(false);
  });
});

describe('status is reported honestly', () => {
  it('never claims a pending write was saved', async () => {
    // §3.10: "Saved on this device" is true and useful; a green tick is a lie. A man who believes
    // his SITREP is filed does not file it again.
    const outbox = enqueue(EMPTY_OUTBOX, 'k', {}, T0);
    const text = describeStatus(statusOf(outbox));
    expect(text).toMatch(/not yet sent/i);
    expect(text).not.toMatch(/\bsaved\b|\bfiled\b|\bdone\b|✓/i);
  });

  it('says so plainly when everything is on the server', async () => {
    const result = await flush(enqueue(EMPTY_OUTBOX, 'k', {}, T0), () => Promise.resolve(), T0);
    expect(describeStatus(statusOf(result.outbox))).toBe('Everything is on the server.');
  });

  it('puts a rejection above a count of pending work', async () => {
    // Something needs his attention; a pending count would bury it.
    let outbox = enqueue(EMPTY_OUTBOX, 'bad', {}, T0);
    outbox = enqueue(outbox, 'waiting', {}, T0);
    const result = await flush(
      outbox,
      (entry) => (entry.key === 'bad' ? Promise.reject(pgError('42501')) : Promise.reject(pgError('08006'))),
      T0,
    );
    const status = statusOf(result.outbox);
    expect(status.state).toBe('rejected');
    expect(status.pending).toBe(1);
    expect(status.rejected).toBe(1);
    expect(describeStatus(status)).toMatch(/refused/i);
  });

  it('reports the oldest held entry so a stuck queue is visible', () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'old', {}, T0);
    outbox = enqueue(outbox, 'new', {}, later(3_600_000));
    expect(statusOf(outbox).oldestFirstQueuedAt).toBe(T0.toISOString());
  });

  it('uses singular and plural correctly, because sloppy copy reads as a bug', () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'a', {}, T0);
    expect(describeStatus(statusOf(outbox))).toBe('Held on this device — not yet sent.');
    outbox = enqueue(outbox, 'b', {}, T0);
    expect(describeStatus(statusOf(outbox))).toContain('2 entries');
  });
});

describe('mixed outcomes in a single flush', () => {
  it('sends what it can and leaves the rest correctly classified', async () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'ok', {}, T0);
    outbox = enqueue(outbox, 'transient', {}, T0);
    outbox = enqueue(outbox, 'permanent', {}, T0);

    const result = await flush(
      outbox,
      (entry: OutboxEntry) => {
        if (entry.key === 'ok') return Promise.resolve();
        if (entry.key === 'transient') return Promise.reject(pgError('08006'));
        return Promise.reject(pgError('23505'));
      },
      T0,
    );

    expect(result.sent).toEqual(['ok']);
    expect(result.retrying).toEqual(['transient']);
    expect(result.rejected).toEqual(['permanent']);
    expect(result.outbox.entries.map((e) => e.key).sort()).toEqual(['permanent', 'transient']);
  });

  it('does nothing to an empty queue', async () => {
    const send = vi.fn(() => Promise.resolve());
    const result = await flush(EMPTY_OUTBOX, send, T0);
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ outbox: EMPTY_OUTBOX, sent: [], retrying: [], rejected: [] });
  });
});

describe('remove', () => {
  it('drops a key and leaves the others', () => {
    let outbox = enqueue(EMPTY_OUTBOX, 'a', {}, T0);
    outbox = enqueue(outbox, 'b', {}, T0);
    expect(remove(outbox, 'a').entries.map((e) => e.key)).toEqual(['b']);
    expect(remove(outbox, 'missing').entries).toHaveLength(2);
  });
});
