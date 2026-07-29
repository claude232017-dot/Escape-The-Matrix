/**
 * Email normalisation and validation.
 *
 * Lives in `lib` rather than in a feature because two features need it — auth for sign-in,
 * circle for invitations — and a feature importing another feature is the knot the
 * import-graph test exists to prevent.
 *
 * Mirror note: the shape check is the same expression as the SQL CHECK
 * `invitations_email_shape`, and lowercasing mirrors `invitations_email_lowercase`. The
 * database is what makes these true; this copy exists to fail fast.
 */

/** Deliberately permissive, and deliberately identical to the SQL CHECK. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Trim and lowercase.
 *
 * Every comparison against a stored address goes through this. Email case-sensitivity is
 * how an invited man gets told he was not invited.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(normaliseEmail(value));
}
