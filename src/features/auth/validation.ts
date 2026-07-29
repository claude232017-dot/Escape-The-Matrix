import { isValidTimeZone } from '@/lib/date';
import { isValidEmail, normaliseEmail } from '@/lib/email';

export { normaliseEmail };

/**
 * Client-side validation for identity fields.
 *
 * Every rule here is a **duplicate** of a database constraint, and that is deliberate: this
 * copy exists only to give a fast, clear error before a round trip. The database is what
 * makes the rule true, because the anon key is public and anything enforced only here is
 * decoration.
 *
 * Each limit names its SQL counterpart. Change one, change both — the mirror note is in
 * supabase/migrations/0002_identity.sql too.
 */

export const LIMITS = {
  /** SQL: profiles_display_name_length */
  displayName: { min: 1, max: 60 },
  /** SQL: profiles_top_g_code_length */
  topGCode: { max: 2000 },
  /** SQL: profiles_command_post_length */
  commandPostNote: { max: 500 },
  /** SQL: profiles_fortress_length */
  fortressProtocol: { max: 1000 },
  /** SQL: profiles_disclosure_version_length */
  disclosureVersion: { max: 40 },
} as const;

export interface FieldError {
  field: string;
  message: string;
}

export function validateDisplayName(value: string): FieldError | null {
  const trimmed = value.trim();
  if (trimmed.length < LIMITS.displayName.min) {
    return { field: 'displayName', message: 'A name is required.' };
  }
  if (trimmed.length > LIMITS.displayName.max) {
    return {
      field: 'displayName',
      message: `Keep it to ${LIMITS.displayName.max} characters or fewer.`,
    };
  }
  return null;
}

export function validateTimezone(value: string): FieldError | null {
  // SQL: profiles_timezone_valid, via app.is_valid_timezone(). A bad value here does not
  // fail loudly at runtime — it silently misattributes a man's day.
  if (!isValidTimeZone(value)) {
    return { field: 'timezone', message: 'Choose a timezone from the list.' };
  }
  return null;
}

export function validateEmail(value: string): FieldError | null {
  const email = normaliseEmail(value);
  if (email === '') return { field: 'email', message: 'An email address is required.' };
  if (!isValidEmail(email)) {
    return { field: 'email', message: 'That does not look like an email address.' };
  }
  return null;
}

export function validateCapped(
  field: keyof typeof LIMITS,
  value: string | null,
): FieldError | null {
  if (value === null) return null;
  const limit = LIMITS[field];
  if (value.length > limit.max) {
    return { field, message: `Keep it to ${limit.max} characters or fewer.` };
  }
  return null;
}

/**
 * Password rules.
 *
 * Length only. No character-class requirements: they measurably push people toward
 * `Password1!` and a note on a monitor, and Supabase already rate-limits and hashes. The
 * floor is 12 rather than the platform default of 6 because this circle's data includes
 * special-category material (docs/SECURITY.md §2).
 */
export const PASSWORD_MIN_LENGTH = 12;

export function validatePassword(value: string): FieldError | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      field: 'password',
      message: `At least ${PASSWORD_MIN_LENGTH} characters. Length beats punctuation.`,
    };
  }
  // Supabase itself rejects above 72 bytes (bcrypt), and failing here with a clear message
  // beats a 422 from the API that the person cannot interpret.
  if (new TextEncoder().encode(value).length > 72) {
    return { field: 'password', message: 'That is too long — 72 bytes is the maximum.' };
  }
  return null;
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): FieldError | null {
  if (password !== confirmation) {
    return { field: 'passwordConfirmation', message: 'The two passwords do not match.' };
  }
  return null;
}

/** First error, or null. Ordered so the person fixes the topmost field first. */
export function firstError(...errors: (FieldError | null)[]): FieldError | null {
  return errors.find((error): error is FieldError => error !== null) ?? null;
}
