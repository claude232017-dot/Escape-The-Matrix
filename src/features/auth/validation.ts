import { isValidEmail, normaliseEmail } from '@/lib/email';
import type { FieldError } from '@/lib/field-validation';

/**
 * Auth-specific validation: credentials.
 *
 * The profile *field* rules live in `@/lib/field-validation` because the profile feature needs
 * them too. What is left here is genuinely about signing in — password rules and the email
 * error message — and belongs to this feature alone.
 */

export function validateEmail(value: string): FieldError | null {
  const email = normaliseEmail(value);
  if (email === '') return { field: 'email', message: 'An email address is required.' };
  if (!isValidEmail(email)) {
    return { field: 'email', message: 'That does not look like an email address.' };
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
