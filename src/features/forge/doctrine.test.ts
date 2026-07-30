import { describe, expect, it } from 'vitest';
import {
  activeProtocols,
  campaignProgress,
  currentStreak,
  DEFAULT_RULESET,
  dayNumber,
  enrollmentAfterReset,
  evaluateDay,
  unreportedDays,
  type DayOutcome,
  type Enrollment,
  type ProtocolForDay,
  type ProtocolResult,
} from '@/features/forge/doctrine';
import { addDays, eachDay, getLocalDateString, type IsoDate } from '@/lib/date';

/** The four seeded protocols, plus the oath. Activation days are placeholders — see below. */
const PROTOCOLS: ProtocolForDay[] = [
  { slug: 'physical-forging', activatesOnDay: 1, isTreasonTrigger: false },
  { slug: 'morning-protocol', activatesOnDay: 1, isTreasonTrigger: false },
  { slug: 'sexual-discipline', activatesOnDay: 1, isTreasonTrigger: true },
  { slug: 'deep-work', activatesOnDay: 4, isTreasonTrigger: false },
  { slug: 'evening-power-down', activatesOnDay: 8, isTreasonTrigger: false },
];

function results(map: Record<string, ProtocolResult['status']>): ProtocolResult[] {
  return Object.entries(map).map(([slug, status]) => ({ slug, status }));
}

const enrollment = (startedOn: IsoDate, id = 'e1'): Enrollment => ({
  id,
  startedOn,
  previousEnrollmentId: null,
});

describe('activation', () => {
  it('holds a protocol inactive until its day', () => {
    expect(activeProtocols(PROTOCOLS, 1).map((p) => p.slug)).toEqual([
      'physical-forging',
      'morning-protocol',
      'sexual-discipline',
    ]);
    expect(activeProtocols(PROTOCOLS, 4)).toHaveLength(4);
    expect(activeProtocols(PROTOCOLS, 8)).toHaveLength(5);
  });

  it('cannot fail a protocol that is not yet live', () => {
    // Reporting a failure for something not yet introduced must not cost him the day.
    const evaluation = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'pass',
        'morning-protocol': 'pass',
        'sexual-discipline': 'pass',
        'deep-work': 'fail',
        'evening-power-down': 'fail',
      }),
    });
    expect(evaluation).toMatchObject({ kind: 'evaluated', outcome: 'complete', failed: [] });
    if (evaluation.kind === 'evaluated') {
      // Ignored, but reported rather than swallowed — a client sending these is out of step.
      expect(evaluation.ignoredInactive).toEqual(['deep-work', 'evening-power-down']);
    }
  });
});

describe('the MED is a pass — the mechanic the whole system rests on', () => {
  it('a day entirely at MED is complete, not a lesser pass', () => {
    const evaluation = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'med_pass',
        'morning-protocol': 'med_pass',
        'sexual-discipline': 'med_pass',
      }),
    });
    expect(evaluation).toMatchObject({ kind: 'evaluated', outcome: 'complete' });
  });

  it('records which protocols were held at MED, so analysis can see it', () => {
    // Visible in analysis, never in judgement.
    const evaluation = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'med_pass',
        'morning-protocol': 'pass',
        'sexual-discipline': 'pass',
      }),
    });
    if (evaluation.kind !== 'evaluated') throw new Error('expected an evaluation');
    expect(evaluation.medPassed).toEqual(['physical-forging']);
    expect(evaluation.outcome).toBe('complete');
  });

  it('never counts toward a zero day', () => {
    // Three MED passes is three wins. If they counted, "the only true failure is zero" would be
    // false and the mechanic would be a trap.
    const evaluation = evaluateDay({
      day: 8,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'med_pass',
        'morning-protocol': 'med_pass',
        'sexual-discipline': 'med_pass',
        'deep-work': 'med_pass',
        'evening-power-down': 'med_pass',
      }),
    });
    expect(evaluation).toMatchObject({ outcome: 'complete', resetKind: null });
  });

  it('does not break a streak', () => {
    const outcomes = new Map<IsoDate, DayOutcome>(
      eachDay('2026-03-01', '2026-03-07').map((d) => [d, 'complete'] as const),
    );
    expect(currentStreak(outcomes, '2026-03-07', '2026-03-01')).toBe(7);
  });
});

describe('failure tiers', () => {
  it('one or two failures is a tactical failure — repeat, campaign continues', () => {
    for (const failing of [['physical-forging'], ['physical-forging', 'morning-protocol']]) {
      const submitted: Record<string, ProtocolResult['status']> = {
        'physical-forging': 'pass',
        'morning-protocol': 'pass',
        'sexual-discipline': 'pass',
      };
      for (const slug of failing) submitted[slug] = 'fail';
      const evaluation = evaluateDay({ day: 1, protocols: PROTOCOLS, results: results(submitted) });
      expect(evaluation, failing.join('+')).toMatchObject({
        outcome: 'repeat',
        resetKind: null,
      });
    }
  });

  it('three failures is a zero day, and a zero day is a reset', () => {
    const evaluation = evaluateDay({
      day: 4,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'fail',
        'morning-protocol': 'fail',
        'deep-work': 'fail',
        'sexual-discipline': 'pass',
      }),
    });
    expect(evaluation).toMatchObject({ outcome: 'reset', resetKind: 'zero_day' });
  });

  it('breaching the oath is treason on its own, however well the rest went', () => {
    const evaluation = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'pass',
        'morning-protocol': 'pass',
        'sexual-discipline': 'fail',
      }),
    });
    expect(evaluation).toMatchObject({ outcome: 'reset', resetKind: 'treason', failed: ['sexual-discipline'] });
  });

  it('names treason rather than zero_day when both apply', () => {
    // The oath is the specific thing that happened; "zero day" would describe it less truthfully,
    // and reset_events is meant to make patterns legible.
    const evaluation = evaluateDay({
      day: 4,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'fail',
        'morning-protocol': 'fail',
        'sexual-discipline': 'fail',
        'deep-work': 'fail',
      }),
    });
    expect(evaluation).toMatchObject({ outcome: 'reset', resetKind: 'treason' });
  });

  it('counts the zero-day threshold against ACTIVE protocols only', () => {
    // Open question 4 in docs/DOCTRINE.md §10. On day 1 only three are live, so three failures is
    // everything he had — and under the current reading that is a zero day.
    const evaluation = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      results: results({
        'physical-forging': 'fail',
        'morning-protocol': 'fail',
        'sexual-discipline': 'pass',
        'deep-work': 'fail',
      }),
    });
    // deep-work is inactive on day 1, so only two failures count: tactical, not treason.
    expect(evaluation).toMatchObject({ outcome: 'repeat' });
  });

  it('honours a tuned threshold', () => {
    const stricter = evaluateDay({
      day: 1,
      protocols: PROTOCOLS,
      ruleset: { zeroDayThreshold: 2 },
      results: results({
        'physical-forging': 'fail',
        'morning-protocol': 'fail',
        'sexual-discipline': 'pass',
      }),
    });
    expect(stricter).toMatchObject({ outcome: 'reset', resetKind: 'zero_day' });
    expect(DEFAULT_RULESET.zeroDayThreshold).toBe(3);
  });
});

describe('an unreported protocol is unknown, not a pass', () => {
  it('refuses to judge an incomplete day', () => {
    // Reading silence as compliance would let a man finish a campaign by leaving the hard ones
    // blank — which corrupts the dataset the product exists to build.
    const evaluation = evaluateDay({
      day: 4,
      protocols: PROTOCOLS,
      results: results({ 'physical-forging': 'pass', 'morning-protocol': 'pass' }),
    });
    expect(evaluation).toEqual({ kind: 'incomplete', missing: ['sexual-discipline', 'deep-work'] });
  });

  it('names every missing protocol so the screen can point at them', () => {
    const evaluation = evaluateDay({ day: 8, protocols: PROTOCOLS, results: [] });
    if (evaluation.kind !== 'incomplete') throw new Error('expected incomplete');
    expect(evaluation.missing).toHaveLength(5);
  });
});

describe('day counting', () => {
  it('starts at Day 1 on the enrollment date', () => {
    expect(dayNumber(enrollment('2026-03-01'), '2026-03-01')).toBe(1);
    expect(dayNumber(enrollment('2026-03-01'), '2026-03-30')).toBe(30);
  });

  it('is unaffected by a DST transition mid-campaign', () => {
    // 2026-03-08 is the US spring-forward; 2026-11-01 the fall-back. A 23- or 25-hour day must
    // not shift the count.
    expect(dayNumber(enrollment('2026-03-01'), '2026-03-09')).toBe(9);
    expect(dayNumber(enrollment('2026-10-25'), '2026-11-02')).toBe(9);
  });

  it('counts a missed day rather than skipping it', () => {
    // Silence does not pause the clock.
    const e = enrollment('2026-03-01');
    expect(dayNumber(e, '2026-03-10')).toBe(10);
    const reported = new Set<IsoDate>(eachDay('2026-03-01', '2026-03-10'));
    reported.delete('2026-03-05');
    reported.delete('2026-03-06');
    expect(unreportedDays(reported, e, '2026-03-10')).toEqual(['2026-03-05', '2026-03-06']);
  });

  it('resolves the day from the member’s own timezone, not the server’s', () => {
    // 01:30 UTC is still the previous evening in Beirut's west and already tomorrow in Tokyo.
    const instant = new Date('2026-03-10T01:30:00Z');
    const e = enrollment('2026-03-01');
    expect(dayNumber(e, getLocalDateString('America/New_York', instant))).toBe(9);
    expect(dayNumber(e, getLocalDateString('Asia/Beirut', instant))).toBe(10);
    expect(dayNumber(e, getLocalDateString('Asia/Tokyo', instant))).toBe(10);
  });

  it('clamps progress at the campaign length', () => {
    const e = enrollment('2026-03-01');
    expect(campaignProgress(e, '2026-03-15', 30)).toEqual({ day: 15, lengthDays: 30, complete: false });
    expect(campaignProgress(e, '2026-03-30', 30)).toEqual({ day: 30, lengthDays: 30, complete: false });
    expect(campaignProgress(e, '2026-04-05', 30)).toEqual({ day: 30, lengthDays: 30, complete: true });
  });
});

describe('a reset destroys nothing — ADR-002', () => {
  it('produces a new enrollment pointing at the old one', () => {
    const first = enrollment('2026-03-01', 'enrollment-1');
    const second = enrollmentAfterReset(first, '2026-03-27', 'enrollment-2');
    expect(second.previousEnrollmentId).toBe('enrollment-1');
    // The chain is what makes the history reachable rather than merely undeleted.
    expect(second.id).not.toBe(first.id);
  });

  it('starts the day AFTER the treason, so no date belongs to two enrollments', () => {
    // Starting on the same date would make 2026-03-27 both day 27 of one enrollment and day 1 of
    // the next, and every aggregate over "day 1" would double-count it.
    const first = enrollment('2026-03-01', 'e1');
    const second = enrollmentAfterReset(first, '2026-03-27', 'e2');
    expect(second.startedOn).toBe('2026-03-28');
    expect(dayNumber(first, '2026-03-27')).toBe(27);
    expect(dayNumber(second, '2026-03-28')).toBe(1);
  });

  it('leaves the previous enrollment answering for its own dates', () => {
    const first = enrollment('2026-03-01', 'e1');
    const second = enrollmentAfterReset(first, '2026-03-27', 'e2');
    // 27 days of protocol results, debriefs and attack hours remain addressable. This is the
    // whole reason the day count is derived rather than stored.
    for (const date of eachDay('2026-03-01', '2026-03-27')) {
      expect(dayNumber(first, date)).toBeGreaterThan(0);
    }
    expect(dayNumber(second, '2026-04-06')).toBe(10);
  });

  it('survives a second reset, keeping the chain intact', () => {
    const first = enrollment('2026-03-01', 'e1');
    const second = enrollmentAfterReset(first, '2026-03-10', 'e2');
    const third = enrollmentAfterReset(second, '2026-03-20', 'e3');
    expect(third.previousEnrollmentId).toBe('e2');
    expect(second.previousEnrollmentId).toBe('e1');
    expect(third.startedOn).toBe('2026-03-21');
  });

  it('handles a reset across a DST boundary', () => {
    const first = enrollment('2026-03-01', 'e1');
    const second = enrollmentAfterReset(first, '2026-03-08', 'e2');
    expect(second.startedOn).toBe('2026-03-09');
    expect(dayNumber(second, '2026-03-15')).toBe(7);
  });
});

describe('streaks', () => {
  const outcomesFor = (entries: Record<string, DayOutcome>) =>
    new Map<IsoDate, DayOutcome>(Object.entries(entries) as [IsoDate, DayOutcome][]);

  it('counts back until a day that was not complete', () => {
    const outcomes = outcomesFor({
      '2026-03-01': 'complete',
      '2026-03-02': 'repeat',
      '2026-03-03': 'complete',
      '2026-03-04': 'complete',
    });
    expect(currentStreak(outcomes, '2026-03-04', '2026-03-01')).toBe(2);
  });

  it('is broken by an absent day, because silence is not a pass', () => {
    const outcomes = outcomesFor({ '2026-03-01': 'complete', '2026-03-03': 'complete' });
    expect(currentStreak(outcomes, '2026-03-03', '2026-03-01')).toBe(1);
  });

  it('is zero when today itself was lost', () => {
    const outcomes = outcomesFor({ '2026-03-01': 'complete', '2026-03-02': 'reset' });
    expect(currentStreak(outcomes, '2026-03-02', '2026-03-01')).toBe(0);
  });

  it('never counts back past the enrollment start', () => {
    // Without the guard this walks backwards for ever on a fully-complete record.
    const outcomes = outcomesFor(
      Object.fromEntries(eachDay('2026-03-01', '2026-03-05').map((d) => [d, 'complete'])),
    );
    expect(currentStreak(outcomes, '2026-03-05', '2026-03-01')).toBe(5);
    expect(currentStreak(outcomes, '2026-03-05', '2026-03-03')).toBe(3);
  });

  it('counts a 30-day campaign held throughout', () => {
    const days = eachDay('2026-03-01', '2026-03-30');
    const outcomes = outcomesFor(Object.fromEntries(days.map((d) => [d, 'complete'])));
    expect(currentStreak(outcomes, '2026-03-30', '2026-03-01')).toBe(30);
  });
});

describe('unreportedDays', () => {
  it('is empty for a fully reported campaign', () => {
    const e = enrollment('2026-03-01');
    const reported = new Set<IsoDate>(eachDay('2026-03-01', '2026-03-05'));
    expect(unreportedDays(reported, e, '2026-03-05')).toEqual([]);
  });

  it('includes today, which is still owed until it is filed', () => {
    const e = enrollment('2026-03-01');
    const reported = new Set<IsoDate>(eachDay('2026-03-01', '2026-03-04'));
    expect(unreportedDays(reported, e, '2026-03-05')).toEqual(['2026-03-05']);
  });

  it('is empty before the campaign has started', () => {
    const e = enrollment('2026-03-10');
    expect(unreportedDays(new Set(), e, '2026-03-09')).toEqual([]);
  });

  it('spans a DST transition without gaining or losing a date', () => {
    const e = enrollment('2026-03-05');
    const missing = unreportedDays(new Set(), e, '2026-03-11');
    expect(missing).toHaveLength(7);
    expect(missing).toContain('2026-03-08');
    expect(missing[missing.length - 1]).toBe('2026-03-11');
    expect(missing[0]).toBe(addDays('2026-03-05', 0));
  });
});
