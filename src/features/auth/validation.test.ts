import { describe, expect, it } from 'vitest';
import {
  firstError,
  LIMITS,
  normaliseEmail,
  PASSWORD_MIN_LENGTH,
  validateCapped,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateTimezone,
} from '@/features/auth/validation';

describe('display name — mirrors profiles_display_name_length', () => {
  it('requires something', () => {
    expect(validateDisplayName('')?.field).toBe('displayName');
    expect(validateDisplayName('   ')?.field).toBe('displayName');
  });

  it('accepts up to the SQL limit and rejects beyond it', () => {
    expect(validateDisplayName('x'.repeat(LIMITS.displayName.max))).toBeNull();
    expect(validateDisplayName('x'.repeat(LIMITS.displayName.max + 1))).not.toBeNull();
  });

  it('measures the trimmed value, as the database will after trimming upstream', () => {
    expect(validateDisplayName(`  ${'x'.repeat(60)}  `)).toBeNull();
  });
});

describe('timezone — mirrors profiles_timezone_valid', () => {
  it('accepts real IANA zones', () => {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Kathmandu', 'Pacific/Auckland']) {
      expect(validateTimezone(tz), tz).toBeNull();
    }
  });

  it('rejects nonsense, an abbreviation and an empty value', () => {
    for (const tz of ['Mars/Olympus_Mons', '', 'GMT+5', 'nonsense']) {
      expect(validateTimezone(tz), tz).not.toBeNull();
    }
  });
});

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

describe('capped fields — mirror the profiles_* length constraints', () => {
  it('enforces each documented limit', () => {
    for (const field of ['topGCode', 'commandPostNote', 'fortressProtocol'] as const) {
      const max = LIMITS[field].max;
      expect(validateCapped(field, 'x'.repeat(max)), field).toBeNull();
      expect(validateCapped(field, 'x'.repeat(max + 1)), field).not.toBeNull();
    }
  });

  it('treats null as absent rather than empty', () => {
    expect(validateCapped('topGCode', null)).toBeNull();
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

describe('firstError', () => {
  it('returns the topmost problem so one field is fixed at a time', () => {
    const a = { field: 'a', message: 'first' };
    const b = { field: 'b', message: 'second' };
    expect(firstError(null, a, b)).toBe(a);
    expect(firstError(null, null)).toBeNull();
  });
});
