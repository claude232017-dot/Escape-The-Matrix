import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  addDays,
  campaignDay,
  compareDates,
  daysBetween,
  dayOfWeek,
  eachDay,
  endOfLocalDay,
  endOfWeek,
  getLocalDateString,
  getLocalHour,
  InvalidDateError,
  InvalidTimeZoneError,
  isProtocolActive,
  isValidIsoDate,
  isValidTimeZone,
  offsetMsAt,
  startOfLocalDay,
  startOfWeek,
  WEEK_STARTS_ON,
} from '@/lib/date';

describe('the test environment itself', () => {
  it('runs in a non-UTC timezone', () => {
    // Not decoration. Every assertion below about day rollover passes trivially in UTC,
    // so a suite that silently ran in UTC would be green against the exact bug it is
    // written to catch. If this fails, vitest.config.ts lost its TZ pin.
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolved).not.toBe('UTC');
    expect(new Date('2026-01-01T05:00:00Z').getHours()).not.toBe(5);
  });
});

describe('getLocalDateString', () => {
  it('returns the date the member is actually living, not the UTC one', () => {
    // 01:30 UTC on New Year's Day is still 20:30 on New Year's Eve in New York.
    const instant = new Date('2026-01-01T01:30:00Z');

    expect(getLocalDateString('America/New_York', instant)).toBe('2025-12-31');

    // The bug this module exists to prevent, stated as an assertion:
    expect(instant.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(getLocalDateString('America/New_York', instant)).not.toBe(
      instant.toISOString().slice(0, 10),
    );
  });

  it('does not roll the day over at 19:00 for a UTC-5 member', () => {
    const evening = new Date('2026-01-15T23:59:00Z'); // 18:59 EST
    const laterEvening = new Date('2026-01-16T00:01:00Z'); // 19:01 EST — UTC has ticked over
    expect(getLocalDateString('America/New_York', evening)).toBe('2026-01-15');
    expect(getLocalDateString('America/New_York', laterEvening)).toBe('2026-01-15');
  });

  it('rolls over at local midnight, and only there', () => {
    const justBefore = new Date('2026-01-16T04:59:59Z'); // 23:59:59 EST
    const justAfter = new Date('2026-01-16T05:00:00Z'); // 00:00:00 EST
    expect(getLocalDateString('America/New_York', justBefore)).toBe('2026-01-15');
    expect(getLocalDateString('America/New_York', justAfter)).toBe('2026-01-16');
  });

  it('gives east-of-UTC members a date ahead of UTC', () => {
    const instant = new Date('2026-03-10T22:00:00Z');
    expect(getLocalDateString('Asia/Tokyo', instant)).toBe('2026-03-11');
    expect(getLocalDateString('Pacific/Kiritimati', instant)).toBe('2026-03-11');
    expect(getLocalDateString('UTC', instant)).toBe('2026-03-10');
    expect(getLocalDateString('America/Los_Angeles', instant)).toBe('2026-03-10');
  });

  it('gives a travelling member the day of the zone he reports against, not the plane', () => {
    // Same instant, home zone vs. the zone his phone has picked up. He files against home.
    const instant = new Date('2026-06-01T03:00:00Z');
    const home = getLocalDateString('America/New_York', instant); // 23:00 on the 31st
    const airport = getLocalDateString('Europe/Berlin', instant); // 05:00 on the 1st
    expect(home).toBe('2026-05-31');
    expect(airport).toBe('2026-06-01');
    // The campaign day must follow `home`; nothing here is allowed to prefer `airport`.
    expect(campaignDay('2026-05-01', home)).toBe(31);
  });

  it('handles half-hour and three-quarter-hour offsets', () => {
    const instant = new Date('2026-02-01T18:45:00Z');
    expect(getLocalDateString('Asia/Kolkata', instant)).toBe('2026-02-02'); // +05:30 → 00:15
    expect(getLocalDateString('Asia/Kathmandu', instant)).toBe('2026-02-02'); // +05:45 → 00:30
    expect(getLocalDateString('Australia/Eucla', instant)).toBe('2026-02-02'); // +08:45 → 03:30
  });

  it('rejects an unknown timezone rather than silently falling back to UTC', () => {
    expect(() => getLocalDateString('Mars/Olympus_Mons')).toThrow(InvalidTimeZoneError);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('getLocalHour', () => {
  it('reports the wall-clock hour in the given zone', () => {
    const instant = new Date('2026-01-15T20:00:00Z');
    expect(getLocalHour('America/New_York', instant)).toBe(15);
    expect(getLocalHour('UTC', instant)).toBe(20);
  });

  it('reports midnight as 0, not 24', () => {
    expect(getLocalHour('America/New_York', new Date('2026-01-16T05:00:00Z'))).toBe(0);
    expect(getLocalHour('UTC', new Date('2026-01-16T00:00:00Z'))).toBe(0);
  });
});

describe('daysBetween', () => {
  it('counts whole days across a spring-forward transition', () => {
    // 2026-03-08 is the US spring-forward. The local day is 23 hours long; naive
    // millisecond division would yield 1.958… and floor to 1.
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
  });

  it('counts whole days across a fall-back transition', () => {
    // 2026-11-01 is 25 hours long locally.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('is signed and zero on the same day', () => {
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // 2024 is a leap year
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // 2026 is not
  });

  it('spans a full 30-day campaign exactly', () => {
    expect(daysBetween('2026-03-01', '2026-03-30')).toBe(29);
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => daysBetween('2026-1-1', '2026-01-02')).toThrow(InvalidDateError);
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(InvalidDateError);
    expect(() => daysBetween('2026-13-01', '2026-03-01')).toThrow(InvalidDateError);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });
});

describe('addDays / compareDates / eachDay', () => {
  it('walks the calendar without clock arithmetic', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // over spring-forward
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31'); // over fall-back
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01');
  });

  it('round-trips against daysBetween', () => {
    const start = '2026-03-01';
    for (let n = -400; n <= 400; n += 7) {
      expect(daysBetween(start, addDays(start, n))).toBe(n);
    }
  });

  it('rejects fractional day shifts', () => {
    expect(() => addDays('2026-01-01', 1.5)).toThrow(InvalidDateError);
  });

  it('sorts and enumerates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(eachDay('2026-03-07', '2026-03-10')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(eachDay('2026-03-07', '2026-03-07')).toEqual(['2026-03-07']);
    expect(() => eachDay('2026-03-10', '2026-03-07')).toThrow(InvalidDateError);
  });
});

describe('week boundaries', () => {
  it('starts the week where DOCTRINE §8 says it does', () => {
    // These helpers were written in Phase 0 assuming Monday, while DOCTRINE §8 still carried
    // an [ASSUMED] tag on it. The owner confirmed Monday on 2026-08-01, which closed the last
    // question blocking Phase 5 — so the constant and the doctrine now agree, and this pins
    // them together rather than trusting that they will stay that way.
    //
    // If the week ever moves, this fails first and points at the document, which is the right
    // order: the doctrine decides and the code follows.
    const doctrine = readFileSync(new URL('../../docs/DOCTRINE.md', import.meta.url), 'utf8');
    expect(doctrine).toMatch(/The week runs \*\*Monday to Sunday\*\*/);
    expect(doctrine).not.toMatch(/The week runs \*\*Monday to Sunday\*\*\. \*\*\[ASSUMED\]/);
    expect(WEEK_STARTS_ON, 'DOCTRINE §8 says Monday; WEEK_STARTS_ON does not').toBe(1);

    // 1 = Monday under the same numbering `dayOfWeek` uses, which is the numbering the
    // helpers actually consume. Asserted rather than assumed — "1" means nothing on its own.
    expect(dayOfWeek('2026-07-27')).toBe(WEEK_STARTS_ON);
  });

  it('starts the week on Monday and ends it on Sunday', () => {
    // 2026-07-29 is a Wednesday.
    expect(dayOfWeek('2026-07-29')).toBe(3);
    expect(startOfWeek('2026-07-29')).toBe('2026-07-27');
    expect(endOfWeek('2026-07-29')).toBe('2026-08-02');
  });

  it('keeps Sunday in the week that has just ended, not the one starting', () => {
    // The mechanism is "declare Monday, settle Sunday" — a Sunday that jumped forward
    // to the next week would leave every commitment unresolvable on the day it is due.
    expect(startOfWeek('2026-08-02')).toBe('2026-07-27');
    expect(startOfWeek('2026-08-03')).toBe('2026-08-03'); // the next Monday
  });

  it('is stable across a DST transition inside the week', () => {
    expect(startOfWeek('2026-03-08')).toBe('2026-03-02');
    expect(endOfWeek('2026-03-08')).toBe('2026-03-08');
    expect(daysBetween(startOfWeek('2026-03-08'), endOfWeek('2026-03-08'))).toBe(6);
  });

  it('gives every date in a week the same week_start key', () => {
    const keys = new Set(eachDay('2026-07-27', '2026-08-02').map((d) => startOfWeek(d)));
    expect([...keys]).toEqual(['2026-07-27']);
  });
});

describe('startOfLocalDay / endOfLocalDay', () => {
  it('resolves local midnight to the right UTC instant either side of DST', () => {
    expect(startOfLocalDay('2026-01-15', 'America/New_York').toISOString()).toBe(
      '2026-01-15T05:00:00.000Z', // EST, UTC-5
    );
    expect(startOfLocalDay('2026-07-15', 'America/New_York').toISOString()).toBe(
      '2026-07-15T04:00:00.000Z', // EDT, UTC-4
    );
  });

  it('makes the SITREP deadline the member’s own midnight', () => {
    // The deadline for the 15th is the first instant of the 16th, locally.
    expect(endOfLocalDay('2026-01-15', 'America/New_York').toISOString()).toBe(
      '2026-01-16T05:00:00.000Z',
    );
    expect(endOfLocalDay('2026-01-15', 'Asia/Tokyo').toISOString()).toBe(
      '2026-01-15T15:00:00.000Z',
    );
  });

  it('produces a 23-hour day on spring-forward and a 25-hour day on fall-back', () => {
    const springMs =
      endOfLocalDay('2026-03-08', 'America/New_York').getTime() -
      startOfLocalDay('2026-03-08', 'America/New_York').getTime();
    const fallMs =
      endOfLocalDay('2026-11-01', 'America/New_York').getTime() -
      startOfLocalDay('2026-11-01', 'America/New_York').getTime();
    expect(springMs).toBe(23 * 3_600_000);
    expect(fallMs).toBe(25 * 3_600_000);
    // …and yet both are exactly one calendar day, which is the whole point.
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('agrees with getLocalDateString at the boundary in both directions', () => {
    for (const tz of ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC']) {
      for (const date of ['2026-03-08', '2026-06-15', '2026-11-01', '2026-12-31']) {
        const start = startOfLocalDay(date, tz);
        expect(getLocalDateString(tz, start)).toBe(date);
        expect(getLocalDateString(tz, new Date(start.getTime() - 1))).toBe(addDays(date, -1));
        expect(getLocalDateString(tz, new Date(endOfLocalDay(date, tz).getTime() - 1))).toBe(date);
      }
    }
  });

  it('reports offsets as whole minutes on either side of a transition', () => {
    expect(offsetMsAt(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * 3_600_000);
    expect(offsetMsAt(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * 3_600_000);
    expect(offsetMsAt(new Date('2026-01-15T12:00:00Z'), 'Asia/Kathmandu')).toBe(5 * 3_600_000 + 45 * 60_000);
  });
});

describe('campaignDay', () => {
  it('counts the start date as Day 1', () => {
    expect(campaignDay('2026-03-01', '2026-03-01')).toBe(1);
    expect(campaignDay('2026-03-01', '2026-03-02')).toBe(2);
    expect(campaignDay('2026-03-01', '2026-03-30')).toBe(30);
  });

  it('is unaffected by a DST transition mid-campaign', () => {
    expect(campaignDay('2026-03-01', '2026-03-09')).toBe(9);
    expect(campaignDay('2026-10-25', '2026-11-02')).toBe(9);
  });

  it('refuses to answer for a date before the enrollment started', () => {
    // A negative campaign day is meaningless and would silently corrupt a war log.
    expect(() => campaignDay('2026-03-01', '2026-02-28')).toThrow(InvalidDateError);
  });

  it('restarts at Day 1 from the new enrollment after a reset, with no counter to decrement', () => {
    // Treason on day 27; a new enrollment row starts the next day. Nothing is deleted:
    // the old enrollment still answers for its own dates. See ADR-002.
    const first = '2026-03-01';
    const second = '2026-03-28';
    expect(campaignDay(first, '2026-03-27')).toBe(27);
    expect(campaignDay(second, '2026-03-28')).toBe(1);
    expect(campaignDay(second, '2026-04-06')).toBe(10);
    // The first enrollment's history remains addressable after the reset.
    expect(campaignDay(first, '2026-03-15')).toBe(15);
  });

  it('counts a missed day rather than skipping it', () => {
    // A day with no SITREP is still a day of the campaign. The count is derived from
    // the calendar, so silence cannot pause the clock.
    expect(campaignDay('2026-03-01', '2026-03-10')).toBe(10);
  });
});

describe('isProtocolActive', () => {
  it('holds a protocol inactive until its activation day', () => {
    expect(isProtocolActive(1, 1)).toBe(true);
    expect(isProtocolActive(8, 7)).toBe(false);
    expect(isProtocolActive(8, 8)).toBe(true);
    expect(isProtocolActive(8, 30)).toBe(true);
  });
});
