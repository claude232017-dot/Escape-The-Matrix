import { beforeEach, describe, expect, it } from 'vitest';
import {
  appKeys,
  APP_PREFIX,
  clearAllAppState,
  clearUserState,
  hasPendingWork,
  LocalStateError,
  readScoped,
  removeScoped,
  scopedKey,
  userKeys,
  writeScoped,
  type StorageLike,
} from '@/lib/local-state';

/** A localStorage stand-in. Node has no DOM, and the real thing adds nothing to test. */
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  /** Set to throw from setItem, to exercise the quota path. */
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
  seed(entries: Record<string, string>): void {
    for (const [k, v] of Object.entries(entries)) this.map.set(k, v);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe('scopedKey', () => {
  it('namespaces by app and user', () => {
    expect(scopedKey('user-1', 'outbox')).toBe(`${APP_PREFIX}:user-1:outbox`);
  });

  it('rejects a colon, which could impersonate another namespace', () => {
    // 'a:b' as a user id would produce etm:a:b:outbox — indistinguishable from user 'a'
    // holding key 'b:outbox', so clearing user 'a' would delete it, or miss it.
    expect(() => scopedKey('a:b', 'outbox')).toThrow(LocalStateError);
    expect(() => scopedKey('user-1', 'out:box')).toThrow(LocalStateError);
  });

  it('rejects empty parts', () => {
    expect(() => scopedKey('', 'outbox')).toThrow(LocalStateError);
    expect(() => scopedKey('user-1', '')).toThrow(LocalStateError);
  });
});

describe('sign-out clears the signing-out member’s state — §3.8', () => {
  beforeEach(() => {
    storage.seed({
      [scopedKey('alice', 'outbox')]: '[1]',
      [scopedKey('alice', 'draft')]: '"x"',
      [scopedKey('bob', 'outbox')]: '[2]',
      'sb-project-auth-token': 'supabase-own-key',
      'unrelated-app-key': 'leave me',
    });
  });

  it('removes everything belonging to that member', () => {
    const removed = clearUserState(storage, 'alice');
    expect(removed.sort()).toEqual([scopedKey('alice', 'draft'), scopedKey('alice', 'outbox')]);
    expect(userKeys(storage, 'alice')).toEqual([]);
  });

  it('leaves nothing for the next person on the device to inherit', () => {
    // The failure being prevented: a queue that outlives its owner's session flushes under
    // the next session, RLS rejects it, and a stranger is shown an error about work they
    // never did.
    clearUserState(storage, 'alice');
    expect(readScoped(storage, 'alice', 'outbox')).toBeNull();
    expect(hasPendingWork(storage, 'alice')).toBe(false);
  });

  it('does NOT destroy another member’s queued work', () => {
    // Scoped rather than a full wipe: on a shared device, Bob's queue is Bob's, it will
    // only ever flush under his own session, and losing it would lose a SITREP he believes
    // was saved.
    clearUserState(storage, 'alice');
    expect(readScoped(storage, 'bob', 'outbox')).toEqual([2]);
  });

  it('does not touch keys belonging to other software', () => {
    clearUserState(storage, 'alice');
    expect(storage.getItem('unrelated-app-key')).toBe('leave me');
    expect(storage.getItem('sb-project-auth-token')).toBe('supabase-own-key');
  });

  it('reports pending work so sign-out can warn before discarding it', () => {
    expect(hasPendingWork(storage, 'alice')).toBe(true);
    clearUserState(storage, 'alice');
    expect(hasPendingWork(storage, 'alice')).toBe(false);
  });

  it('is idempotent', () => {
    clearUserState(storage, 'alice');
    expect(clearUserState(storage, 'alice')).toEqual([]);
  });

  it('does not match a user id that is a prefix of another', () => {
    // 'user-1' must not clear 'user-10'. The trailing colon in userPrefix is what prevents
    // this, and it is exactly the kind of detail that is silently wrong without a test.
    storage.seed({
      [scopedKey('user-1', 'a')]: '1',
      [scopedKey('user-10', 'a')]: '1',
    });
    clearUserState(storage, 'user-1');
    expect(userKeys(storage, 'user-10')).toEqual([scopedKey('user-10', 'a')]);
  });
});

describe('clearAllAppState', () => {
  it('removes every app key but nothing else', () => {
    storage.seed({
      [scopedKey('alice', 'outbox')]: '[]',
      [scopedKey('bob', 'outbox')]: '[]',
      'unrelated-app-key': 'keep',
    });
    clearAllAppState(storage);
    expect(appKeys(storage)).toEqual([]);
    expect(storage.getItem('unrelated-app-key')).toBe('keep');
  });
});

describe('readScoped / writeScoped', () => {
  it('round-trips structured values', () => {
    expect(writeScoped(storage, 'alice', 'outbox', { queued: [1, 2] })).toBe(true);
    expect(readScoped(storage, 'alice', 'outbox')).toEqual({ queued: [1, 2] });
  });

  it('returns null for an absent key', () => {
    expect(readScoped(storage, 'alice', 'nothing')).toBeNull();
  });

  it('drops a corrupt value rather than letting it break every load', () => {
    storage.seed({ [scopedKey('alice', 'outbox')]: '{not json' });
    expect(readScoped(storage, 'alice', 'outbox')).toBeNull();
    // Dropped, not left in place — otherwise it fails again on the next load, forever.
    expect(storage.getItem(scopedKey('alice', 'outbox'))).toBeNull();
  });

  it('reports a failed write instead of throwing', () => {
    // The caller must be able to tell the man his report is NOT held on this device. A
    // thrown quota error would either crash the entry screen or be swallowed into a lie.
    storage.failWrites = true;
    expect(writeScoped(storage, 'alice', 'outbox', { queued: [] })).toBe(false);
  });

  it('removes a single key', () => {
    writeScoped(storage, 'alice', 'draft', 'x');
    removeScoped(storage, 'alice', 'draft');
    expect(readScoped(storage, 'alice', 'draft')).toBeNull();
  });
});
