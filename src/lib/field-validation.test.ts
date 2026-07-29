import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '@/lib/date';
import {
  emptyToNull,
  firstError,
  LIMITS,
  validateCapped,
  validateDisplayName,
  validateTimezone,
} from '@/lib/field-validation';

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

describe('emptyToNull', () => {
  it('distinguishes "he wrote nothing" from "he has not set this"', () => {
    // The column is nullable and the two mean different things: the Morning Protocol MED has
    // to know whether it can show his Code at all.
    expect(emptyToNull('')).toBeNull();
    expect(emptyToNull('   \n  ')).toBeNull();
    expect(emptyToNull('  I am the cause.  ')).toBe('I am the cause.');
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

describe('the timezone rule is the same one the database enforces', () => {
  it('accepts exactly what isValidTimeZone accepts', () => {
    // Mirror note made executable: if these ever disagree, the client shows a green field for
    // a value profiles_timezone_valid will reject.
    for (const tz of ['UTC', 'Asia/Beirut', 'Mars/Olympus_Mons', '', 'GMT+5']) {
      expect(validateTimezone(tz) === null, tz).toBe(isValidTimeZone(tz));
    }
  });
});
