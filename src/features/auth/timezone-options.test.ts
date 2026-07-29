import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '@/lib/date';
import {
  guessTimezone,
  offsetLabel,
  timezoneLabel,
  timezoneOptions,
} from '@/features/auth/timezone-options';

describe('timezoneOptions', () => {
  it('offers a usable list', () => {
    const options = timezoneOptions();
    expect(options.length).toBeGreaterThan(40);
    expect(options).toContain('UTC');
  });

  it('offers only zones the date library will accept', () => {
    // Every option must survive profiles_timezone_valid on the way in, or the setup screen
    // hands a man a choice the database will reject.
    const invalid = timezoneOptions().filter((tz) => !isValidTimeZone(tz));
    expect(invalid, `unusable options: ${invalid.join(', ')}`).toEqual([]);
  });

  it('has no duplicates', () => {
    const options = timezoneOptions();
    expect(new Set(options).size).toBe(options.length);
  });
});

describe('guessTimezone', () => {
  it('returns a valid zone', () => {
    expect(isValidTimeZone(guessTimezone())).toBe(true);
  });

  it('is only ever a preselection, never a silent decision', () => {
    // Documented as a test because the failure is invisible: a laptop still on holiday time
    // would otherwise set the zone every future day count is measured against.
    // Under the suite's pinned TZ the guess is New York, and it must not be assumed correct.
    expect(guessTimezone()).toBe('America/New_York');
    expect(timezoneOptions()).toContain(guessTimezone());
  });
});

describe('offsetLabel', () => {
  it('reports whole-hour, half-hour and quarter-hour offsets', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    expect(offsetLabel('UTC', winter)).toBe('+00:00');
    expect(offsetLabel('America/New_York', winter)).toBe('-05:00');
    expect(offsetLabel('Asia/Kolkata', winter)).toBe('+05:30');
    expect(offsetLabel('Asia/Kathmandu', winter)).toBe('+05:45');
    expect(offsetLabel('Australia/Eucla', winter)).toBe('+08:45');
  });

  it('follows daylight saving, so the label matches the clock on the wall today', () => {
    expect(offsetLabel('America/New_York', new Date('2026-07-15T12:00:00Z'))).toBe('-04:00');
    expect(offsetLabel('Europe/London', new Date('2026-07-15T12:00:00Z'))).toBe('+01:00');
    expect(offsetLabel('Europe/London', new Date('2026-01-15T12:00:00Z'))).toBe('+00:00');
  });

  it('is empty for a zone that does not exist, rather than guessing', () => {
    expect(offsetLabel('Mars/Olympus_Mons')).toBe('');
  });
});

describe('timezoneLabel', () => {
  it('shows the offset so the choice can be checked against a clock', () => {
    expect(timezoneLabel('Asia/Kolkata', new Date('2026-01-15T12:00:00Z'))).toBe(
      'Asia/Kolkata (+05:30)',
    );
  });

  it('falls back to the bare name for an unknown zone', () => {
    expect(timezoneLabel('Mars/Olympus_Mons')).toBe('Mars/Olympus_Mons');
  });
});
