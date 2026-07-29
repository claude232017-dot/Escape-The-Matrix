import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth/validation';
import { normaliseEmail } from '@/lib/email';

describe('email — mirrors invitations_email_lowercase and _email_shape', () => {
  it('lowercases and trims', () => {
    // Email case-sensitivity is how an invited man gets told he was not invited.
    expect(normaliseEmail('  MiXeD@Example.COM ')).toBe('mixed@example.com');
  });

  it('accepts a plausible address', () => {
    expect(validateEmail('man@example.com')).toBeNull();
    expect(validateEmail('  MAN@EXAMPLE.COM  ')).toBeNull();
  });

  it('rejects what the SQL CHECK would reject', () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@example.com', 'two@@example.com']) {
      expect(validateEmail(bad), bad).not.toBeNull();
    }
  });
});

describe('password', () => {
  it('requires length, not punctuation', () => {
    // Character-class rules push people to Password1! and a note on the monitor.
    expect(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validatePassword('correct horse battery staple')).toBeNull();
    expect(validatePassword('x'.repeat(PASSWORD_MIN_LENGTH - 1))).not.toBeNull();
  });

  it('rejects above bcrypt’s 72-byte ceiling, counted in bytes', () => {
    // Supabase rejects this with a 422 the person cannot interpret; failing here is kinder.
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(73))).not.toBeNull();
    // Multi-byte characters hit the ceiling sooner than their length suggests.
    expect(validatePassword('é'.repeat(37))).not.toBeNull();
    expect(validatePassword('é'.repeat(36))).toBeNull();
  });

  it('catches a mismatched confirmation', () => {
    expect(validatePasswordConfirmation('abcdefghijkl', 'abcdefghijkl')).toBeNull();
    expect(validatePasswordConfirmation('abcdefghijkl', 'abcdefghijkm')?.field).toBe(
      'passwordConfirmation',
    );
  });
});
