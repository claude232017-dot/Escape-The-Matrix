/**
 * Classifying a failed write by **SQLSTATE**, never by matching its message text.
 *
 * This is the whole reason the module exists. Prose matching reads a `42501` permission denial
 * as a network blip and retries it for ever, in silence — the man's report never lands, nothing
 * tells him, and the queue grows until the browser's storage quota stops it.
 *
 * A SQLSTATE is five characters: a two-character class and a three-character subclass. The class
 * alone is usually enough to decide whether waiting could possibly help.
 */

export type FailureClass =
  /** Waiting cannot help. The request itself is wrong. Surface it to the person. */
  | 'permanent'
  /** Waiting plausibly helps: the network, the server, or a lock. Retry with backoff. */
  | 'transient'
  /**
   * Not recognised.
   *
   * Retried, but with a bounded attempt count, because the two ways to be wrong here are not
   * symmetric: giving up on a recoverable error loses one report, while retrying an unrecoverable
   * one for ever loses the report *and* hides that fact.
   */
  | 'unknown';

/** Classes where waiting cannot help. */
const PERMANENT_CLASSES = new Set([
  '22', // data exception — bad value, out of range, invalid text representation
  '23', // integrity constraint violation — unique, foreign key, check, not-null
  '42', // syntax error or access rule violation — includes 42501 insufficient_privilege (RLS)
  '2F', // SQL function exception
  '38', // external routine exception
  '39', // external routine invocation exception
]);

/** Classes where waiting plausibly helps. */
const TRANSIENT_CLASSES = new Set([
  '08', // connection exception
  '53', // insufficient resources — too many connections, disk full
  '57', // operator intervention — query cancelled, admin shutdown
  '58', // system error — I/O
  '54', // program limit exceeded — often a momentary resource ceiling
]);

/**
 * Specific codes that contradict their class.
 *
 * `40001` and `40P01` are class 40 (transaction rollback), which reads as permanent but is the
 * textbook retry case: a serialisation failure or a deadlock succeeds on a second attempt.
 */
const TRANSIENT_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

export function classifySqlstate(code: string | null | undefined): FailureClass {
  if (!code) return 'unknown';
  const normalised = code.trim().toUpperCase();
  if (normalised === '') return 'unknown';

  if (TRANSIENT_CODES.has(normalised)) return 'transient';

  const errorClass = normalised.slice(0, 2);
  if (PERMANENT_CLASSES.has(errorClass)) return 'permanent';
  if (TRANSIENT_CLASSES.has(errorClass)) return 'transient';

  // Class 00 is success and should never reach here; treating it as unknown rather than
  // asserting keeps a confused caller from crashing the entry screen.
  return 'unknown';
}

/**
 * Pull a SQLSTATE out of whatever the client threw.
 *
 * supabase-js surfaces PostgREST errors as `{ code, message, details, hint }` where `code` is the
 * SQLSTATE; node-postgres uses `code` too. A network failure has no code at all, which is
 * classified `unknown` and therefore retried — correct, because a fetch that never reached the
 * server is exactly what the queue is for.
 */
export function sqlstateOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const record = cause as Record<string, unknown>;
  const code = record['code'];
  // A five-character SQLSTATE, not an HTTP status or a string enum like 'ECONNREFUSED'.
  if (typeof code === 'string' && /^[0-9A-Za-z]{5}$/.test(code.trim())) return code.trim();
  const nested = record['cause'];
  if (nested && typeof nested === 'object') return sqlstateOf(nested);
  return null;
}

/** Classify a thrown value directly. */
export function classifyFailure(cause: unknown): FailureClass {
  return classifySqlstate(sqlstateOf(cause));
}

/**
 * A failure that never reached the server, given the SQLSTATE that describes it.
 *
 * `08006` is `connection_failure`, class 08 — which @/lib/sqlstate already classifies as
 * transient. Assigning the right code at the boundary is not the same as classifying by message
 * text: §3.10 forbids reading prose to decide whether to retry, and this decides from
 * `navigator.onLine`, which is a fact about the transport rather than a string a server chose.
 */
export class OfflineError extends Error {
  readonly code = '08006';

  constructor(cause?: unknown) {
    super('The request did not reach the server: this device is offline.');
    this.name = 'OfflineError';
    if (cause !== undefined) this.cause = cause;
  }
}
