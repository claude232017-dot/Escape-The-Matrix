/**
 * Per-user local storage, and the rule that sign-out empties it.
 *
 * Everything this app keeps on a device — the Phase 2 outbox, drafts, caches — belongs to
 * one specific member. If it survives his sign-out, the next person on the device inherits
 * it, it flushes under *their* session, RLS rejects it, and they are shown a stranger's
 * error about work they never did.
 *
 * So keys are namespaced by user id and cleared on sign-out. The namespace is not a
 * convention: `scopedKey` is the only sanctioned way to build one, and `clearUserState`
 * finds them by prefix rather than by a list someone has to remember to update.
 */

/** Prefix for everything this app writes. Never write a key outside it. */
export const APP_PREFIX = 'etm';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export class LocalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalStateError';
  }
}

/**
 * `etm:<userId>:<name>` — the only sanctioned key shape.
 *
 * Rejects a colon in either part, because a key that can contain the separator can be
 * crafted to collide with another user's namespace, and `clearUserState` would then miss
 * it or over-match.
 */
export function scopedKey(userId: string, name: string): string {
  if (!userId) throw new LocalStateError('scopedKey requires a user id');
  if (!name) throw new LocalStateError('scopedKey requires a name');
  if (userId.includes(':') || name.includes(':')) {
    throw new LocalStateError(
      `Colons are not allowed in a scoped key (${JSON.stringify(userId)}, ${JSON.stringify(name)}) — they would let one namespace impersonate another`,
    );
  }
  return `${APP_PREFIX}:${userId}:${name}`;
}

export function userPrefix(userId: string): string {
  if (!userId) throw new LocalStateError('userPrefix requires a user id');
  return `${APP_PREFIX}:${userId}:`;
}

/** Every key currently present for this app, across all users. */
export function appKeys(storage: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(`${APP_PREFIX}:`)) keys.push(key);
  }
  return keys;
}

/** Keys belonging to one member. */
export function userKeys(storage: StorageLike, userId: string): string[] {
  const prefix = userPrefix(userId);
  return appKeys(storage).filter((key) => key.startsWith(prefix));
}

/**
 * Remove everything belonging to one member. Called on sign-out.
 *
 * Scoped to the signing-out user rather than wiping the whole app namespace: on a shared
 * device, another member's queued work is *his*, it will only ever flush under his own
 * session, and destroying it would lose a SITREP he believes was saved.
 *
 * The cost is the other direction — this member's own unsent work is discarded on
 * sign-out. That is the intended trade (a queue that outlives its owner's session is the
 * bug being prevented), but it means the sign-out control must warn when
 * `hasPendingWork()` is true rather than silently discarding.
 */
export function clearUserState(storage: StorageLike, userId: string): string[] {
  const removed = userKeys(storage, userId);
  for (const key of removed) storage.removeItem(key);
  return removed;
}

/** Remove every app key regardless of owner. For a deliberate full reset, not sign-out. */
export function clearAllAppState(storage: StorageLike): string[] {
  const removed = appKeys(storage);
  for (const key of removed) storage.removeItem(key);
  return removed;
}

/**
 * Read and parse a scoped value.
 *
 * Returns `null` rather than throwing on unparseable JSON: a corrupt local value must not
 * be able to stop the app from starting. It is dropped, because a value nobody can read
 * is indistinguishable from absent and keeping it would fail again on every load.
 */
export function readScoped<T>(storage: StorageLike, userId: string, name: string): T | null {
  const raw = storage.getItem(scopedKey(userId, name));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.removeItem(scopedKey(userId, name));
    return null;
  }
}

/**
 * Write a scoped value.
 *
 * Returns false rather than throwing when the quota is exhausted. The caller decides what
 * that means — for the outbox it means telling the man his report is NOT held on this
 * device, which is the one thing he must never be wrong about.
 */
export function writeScoped(
  storage: StorageLike,
  userId: string,
  name: string,
  value: unknown,
): boolean {
  try {
    storage.setItem(scopedKey(userId, name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeScoped(storage: StorageLike, userId: string, name: string): void {
  storage.removeItem(scopedKey(userId, name));
}

/** True when this member has state on the device that sign-out would discard. */
export function hasPendingWork(storage: StorageLike, userId: string): boolean {
  return userKeys(storage, userId).length > 0;
}
