/**
 * Turning an unknown thrown value into something a man can act on.
 *
 * This exists as its own module because the first version of it put the literal string `{}`
 * on screen. It read `cause.message`, found no pattern matched, and returned it verbatim —
 * so a real failure was reported as two braces. An error message that tells the person
 * nothing is worse than no error message, because it also tells them the app is broken in a
 * way nobody can describe.
 *
 * Two rules follow from that:
 *
 *  1. **Never surface a message that carries no information.** `{}`, `[object Object]`, an
 *     empty string and bare whitespace are all treated as absent.
 *  2. **Always leave a thread to pull.** When there is nothing better to say, include the
 *     status or error code, so the next question ("what does it say?") has an answer.
 *
 * GoTrue is the reason this needs to look in several places: depending on the endpoint and
 * version, the human-readable text arrives as `message`, `msg`, `error_description` or
 * `error`, and Postgres errors add `details` and `hint`.
 */

/** Strings that look like a message but contain nothing. */
const EMPTY_SHAPES = new Set(['', '{}', '[]', 'null', 'undefined', '[object object]']);

function usable(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (EMPTY_SHAPES.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/** Every field an auth or Postgres error might hide its text in, most specific first. */
const TEXT_FIELDS = ['message', 'msg', 'error_description', 'error', 'details', 'hint'] as const;

function extractText(cause: unknown): string | null {
  if (typeof cause === 'string') return usable(cause);
  if (typeof cause !== 'object' || cause === null) return null;

  const record = cause as Record<string, unknown>;
  for (const field of TEXT_FIELDS) {
    const found = usable(record[field]);
    if (found) return found;
  }
  // A wrapped error: `{ cause: realError }` or `{ error: realError }`.
  for (const field of ['cause', 'error'] as const) {
    const nested = record[field];
    if (nested && typeof nested === 'object') {
      const found = extractText(nested);
      if (found) return found;
    }
  }
  return null;
}

/** A status or code to quote when there is no usable text, so the failure stays diagnosable. */
function extractCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;
  const record = cause as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of ['status', 'code', 'error_code', 'name'] as const) {
    const value = record[field];
    if (typeof value === 'string' && usable(value)) parts.push(`${field} ${value.trim()}`);
    if (typeof value === 'number') parts.push(`${field} ${value}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

export function authErrorMessage(cause: unknown): string {
  const raw = extractText(cause);

  if (raw) {
    if (/invalid login credentials/i.test(raw)) return 'That email and password do not match.';
    if (/email not confirmed/i.test(raw)) return 'Confirm your email address first.';
    if (/signup_requires_invitation/i.test(raw)) {
      return 'That address has no live invitation. Ask the mentor for one.';
    }
    // GoTrue collapses any error raised by a trigger on auth.users into this one string, so
    // the invite check's own message usually never reaches the browser. Name the likely cause
    // without asserting it — and deliberately do NOT add an "is this address invited?"
    // endpoint to find out, because that would be an enumeration oracle for who is in the
    // circle, which is the thing invite-only exists to protect.
    if (/database error (saving|creating) new user|unexpected_failure/i.test(raw)) {
      return (
        'Your account could not be created. The most likely reason is that this address has ' +
        'no live invitation — check with the mentor that he used exactly this address, ' +
        'including any dots or plus signs.'
      );
    }
    if (/user already registered|already been registered|already exists/i.test(raw)) {
      return 'There is already an account for that address. Sign in instead, or reset your password.';
    }
    if (/signups? not allowed|signup is disabled/i.test(raw)) {
      return 'Sign-ups are switched off for this project. The mentor needs to enable the email provider in Supabase.';
    }
    if (/rate limit|too many|429/i.test(raw)) return 'Too many attempts. Wait a minute and try again.';
    if (/row-level security|violates row/i.test(raw)) return 'You do not have access to that.';
    if (/failed to fetch|networkerror|load failed/i.test(raw)) {
      return 'Could not reach the server. Check your connection and try again.';
    }
    return raw;
  }

  // Nothing readable. Quote whatever identifiers exist rather than shrugging, because "it
  // said {}" is not something anyone can investigate.
  const code = extractCode(cause);
  return code
    ? `The server rejected that without explaining why (${code}). If this keeps happening, the mentor should check the Supabase auth logs.`
    : 'Something went wrong and the server gave no reason. If this keeps happening, the mentor should check the Supabase auth logs.';
}
