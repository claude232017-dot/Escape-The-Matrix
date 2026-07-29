import { isValidTimeZone } from '@/lib/date';

/**
 * Validation for the fields on a member's profile.
 *
 * In `lib` because two features need it — `auth` at signup and `profile` afterwards — and a
 * feature importing another feature is the knot the import-graph test rejects.
 *
 * Every rule here is a **duplicate** of a database constraint, deliberately. This copy exists
 * only to give a fast, clear error before a round trip; the database is what makes the rule
 * true, because the anon key is public and anything enforced only here is decoration.
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

export type CappedField = keyof typeof LIMITS;

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
  // SQL: profiles_timezone_valid, via app.is_valid_timezone(). A bad value here does not fail
  // loudly at runtime — it silently misattributes a man's day.
  if (!isValidTimeZone(value)) {
    return { field: 'timezone', message: 'Choose a timezone from the list.' };
  }
  return null;
}

export function validateCapped(field: CappedField, value: string | null): FieldError | null {
  if (value === null) return null;
  const limit = LIMITS[field];
  if (value.length > limit.max) {
    return { field, message: `Keep it to ${limit.max} characters or fewer.` };
  }
  return null;
}

/** First error, or null. Ordered so the person fixes the topmost field first. */
export function firstError(...errors: (FieldError | null)[]): FieldError | null {
  return errors.find((error): error is FieldError => error !== null) ?? null;
}

/**
 * Trim and collapse an optional text field, returning null for "nothing".
 *
 * `null` rather than `''` because the column is nullable and the two mean different things:
 * an empty string says "he wrote nothing here", null says "he has not set this". The Morning
 * Protocol MED needs to tell those apart to know whether it can show his Code at all.
 */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
