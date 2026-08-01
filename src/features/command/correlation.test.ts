import { describe, expect, it } from 'vitest';
import {
  COMPARISON_MINIMUM,
  allActions,
  comparison,
  daysSilent,
  deepWork,
  finding,
  held,
  needsAttention,
  weeks,
  type MemberDay,
  type Standing,
} from '@/features/command/correlation';

function day(over: Partial<MemberDay> = {}): MemberDay {
  return {
    profileId: 'me',
    localDate: '2026-07-27',
    finalStatus: 'complete',
    deepWorkBlocks: 0,
    businessActions: 0,
    revenueMinor: '0',
    currency: null,
    currencyCount: 0,
    ...over,
  };
}

/** `n` days of one status, one per calendar day from 2026-07-06 (a Monday). */
function run(n: number, status: MemberDay['finalStatus'], blocks: number): MemberDay[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 6 + i));
    return day({
      localDate: d.toISOString().slice(0, 10),
      finalStatus: status,
      deepWorkBlocks: blocks,
      businessActions: blocks * 2,
    });
  });
}

describe('what counts as held', () => {
  it('is a complete day and nothing else', () => {
    expect(held(day({ finalStatus: 'complete' }))).toBe(true);
    expect(held(day({ finalStatus: 'reset' }))).toBe(false);
    // A repeat is survivable but the line moved. Folding it in with clean days would blur the
    // exact distinction the comparison exists to test.
    expect(held(day({ finalStatus: 'repeat' }))).toBe(false);
  });
});

describe('comparison', () => {
  it('compares the metric across held and broken days', () => {
    const days = [...run(6, 'complete', 4), ...run(6, 'reset', 1)];
    const c = comparison(days, deepWork);
    expect(c.onHeldDays).toBe(4);
    expect(c.onBrokenDays).toBe(1);
    expect(c.heldCount).toBe(6);
    expect(c.brokenCount).toBe(6);
    expect(c.enough).toBe(true);
  });

  it('excludes repeat days from both groups rather than guessing', () => {
    // A repeat put on either side moves the answer by a decision nobody made on purpose.
    const days = [...run(6, 'complete', 4), ...run(6, 'reset', 1), ...run(3, 'repeat', 99)];
    const c = comparison(days, deepWork);
    expect(c.heldCount).toBe(6);
    expect(c.brokenCount).toBe(6);
    expect(c.onHeldDays).toBe(4);
    expect(c.onBrokenDays).toBe(1);
  });

  it('needs the minimum on BOTH sides, not in total', () => {
    // Twenty held days and one bad one is not evidence about bad days, however large the total.
    const lopsided = [...run(20, 'complete', 4), ...run(1, 'reset', 0)];
    expect(comparison(lopsided, deepWork).enough).toBe(false);

    const exact = [
      ...run(COMPARISON_MINIMUM, 'complete', 4),
      ...run(COMPARISON_MINIMUM, 'reset', 1),
    ];
    expect(comparison(exact, deepWork).enough).toBe(true);
  });

  it('does not divide by zero on an empty group', () => {
    const c = comparison(run(3, 'complete', 4), deepWork);
    expect(c.onBrokenDays).toBe(0);
    expect(Number.isNaN(c.onBrokenDays)).toBe(false);
    expect(c.enough).toBe(false);
  });

  it('works on either metric', () => {
    const days = [...run(6, 'complete', 4), ...run(6, 'reset', 1)];
    expect(comparison(days, allActions).onHeldDays).toBe(8);
    expect(comparison(days, allActions).onBrokenDays).toBe(2);
  });
});

describe('finding', () => {
  it('refuses to claim anything without enough on both sides', () => {
    // The rule this whole module is built around. For most of a campaign this is the *correct*
    // answer, not a failure — see AttackPatternPanel, which refuses the same way.
    const thin = [...run(3, 'complete', 9), ...run(3, 'reset', 0)];
    expect(finding(comparison(thin, deepWork))).toBe('not-enough');
  });

  it('names the direction when the evidence is there', () => {
    const good = [...run(6, 'complete', 4), ...run(6, 'reset', 1)];
    expect(finding(comparison(good, deepWork))).toBe('higher-when-held');
  });

  it('is willing to report the uncomfortable direction', () => {
    // If a man does more business work on the days his discipline broke, that is a finding and
    // the app says so. An engine that could only produce the flattering answer is not an engine.
    const inverted = [...run(6, 'complete', 1), ...run(6, 'reset', 4)];
    expect(finding(comparison(inverted, deepWork))).toBe('higher-when-broken');
  });

  it('says no difference rather than inventing a small one', () => {
    const flat = [...run(6, 'complete', 3), ...run(6, 'reset', 3)];
    expect(finding(comparison(flat, deepWork))).toBe('no-difference');
  });

  it('treats a gap under a tenth of a block as no difference', () => {
    // Two means that differ in the third decimal are the same number wearing different
    // rounding. Claiming that as a finding is the fake precision this module exists to avoid.
    const days = [
      ...run(10, 'complete', 3),
      ...run(10, 'reset', 3),
      day({ localDate: '2026-08-20', finalStatus: 'complete', deepWorkBlocks: 4 }),
    ];
    const c = comparison(days, deepWork);
    expect(c.onHeldDays).toBeGreaterThan(c.onBrokenDays);
    expect(c.onHeldDays - c.onBrokenDays).toBeLessThan(0.1);
    expect(finding(c)).toBe('no-difference');
  });
});

describe('weekly rollup', () => {
  it('groups by the Monday and reports newest first', () => {
    const days = [
      day({ localDate: '2026-07-27', deepWorkBlocks: 2 }),
      day({ localDate: '2026-07-29', deepWorkBlocks: 3 }),
      day({ localDate: '2026-08-03', deepWorkBlocks: 1 }),
    ];
    const rolled = weeks(days);
    expect(rolled.map((w) => w.weekStart)).toEqual(['2026-08-03', '2026-07-27']);
    expect(rolled[1]?.deepWorkBlocks).toBe(5);
  });

  it('sums revenue in minor units without touching a float', () => {
    // §3.2. Ten million pounds to the penny, twice, added as BigInt.
    const days = [
      day({ localDate: '2026-07-27', revenueMinor: '1000000000', currency: 'GBP' }),
      day({ localDate: '2026-07-28', revenueMinor: '1', currency: 'GBP' }),
    ];
    expect(weeks(days)[0]?.revenueMinor).toBe('1000000001');
    expect(weeks(days)[0]?.currency).toBe('GBP');
  });

  it('refuses to total a week that mixed currencies', () => {
    // Adding dollars to pounds produces a number that is wrong in a way that looks right.
    const days = [
      day({ localDate: '2026-07-27', revenueMinor: '10000', currency: 'GBP' }),
      day({ localDate: '2026-07-28', revenueMinor: '10000', currency: 'USD' }),
    ];
    const rolled = weeks(days)[0];
    expect(rolled?.mixedCurrency).toBe(true);
    expect(rolled?.currency).toBeNull();
    expect(rolled?.revenueMinor, 'a mixed-currency total was still offered').toBe('0');
  });

  it('counts held and reset days per week', () => {
    const days = [
      day({ localDate: '2026-07-27', finalStatus: 'complete' }),
      day({ localDate: '2026-07-28', finalStatus: 'reset' }),
      day({ localDate: '2026-07-29', finalStatus: 'repeat' }),
    ];
    const rolled = weeks(days)[0];
    expect(rolled).toMatchObject({ daysReported: 3, daysHeld: 1, daysReset: 1 });
  });

  it('returns nothing for no days, rather than an empty week', () => {
    expect(weeks([])).toEqual([]);
  });
});

describe('daysSilent', () => {
  it('does not count today, because a day is not late until it is over', () => {
    expect(daysSilent('2026-07-29', '2026-07-30')).toBe(0);
    expect(daysSilent('2026-07-30', '2026-07-30')).toBe(0);
  });

  it('counts each full day of silence', () => {
    expect(daysSilent('2026-07-27', '2026-07-30')).toBe(2);
    expect(daysSilent('2026-07-20', '2026-07-30')).toBe(9);
  });

  it('gives zero for a man who has never filed', () => {
    // Null, not a large number: "has not started" and "has stopped" are different situations,
    // and a mentor should not have to infer which one he is looking at from a big integer.
    expect(daysSilent(null, '2026-07-30')).toBe(0);
  });
});

describe('needsAttention', () => {
  function standing(over: Partial<Standing> = {}): Standing {
    return {
      profileId: 'a',
      displayName: 'Marcus',
      lastReported: '2026-07-30',
      daysSilent: 0,
      daysHeld: 5,
      daysReset: 0,
      commitmentsPending: 0,
      ...over,
    };
  }

  it('returns nobody when there is nothing to flag', () => {
    // A commander's view that lists everyone every day trains the reader to skim it.
    expect(needsAttention([standing(), standing({ profileId: 'b' })])).toEqual([]);
  });

  it('flags silence, unresolved commitments and resets', () => {
    const flagged = needsAttention([
      standing({ profileId: 'quiet', daysSilent: 3 }),
      standing({ profileId: 'owing', commitmentsPending: 2 }),
      standing({ profileId: 'broke', daysReset: 1 }),
      standing({ profileId: 'fine' }),
    ]);
    // Membership, not order — ordering is the next test's job. Sorted here so this one does not
    // fail when the ordering rule changes for a reason that has nothing to do with it.
    expect([...flagged.map((s) => s.profileId)].sort()).toEqual(['broke', 'owing', 'quiet']);
    expect(flagged.map((s) => s.profileId)).not.toContain('fine');
  });

  it('orders by need for attention, not by performance', () => {
    // The distinction that keeps this from being a leaderboard: the man doing worst is at the
    // top, which is the opposite of what a ranking would do with him.
    const flagged = needsAttention([
      standing({ profileId: 'a', daysSilent: 2 }),
      standing({ profileId: 'b', daysSilent: 9 }),
      standing({ profileId: 'c', daysSilent: 4 }),
    ]);
    expect(flagged.map((s) => s.profileId)).toEqual(['b', 'c', 'a']);
  });

  it('does not flag a single quiet day', () => {
    // Yesterday's silence is not drift. Flagging it would make the list permanent noise.
    expect(needsAttention([standing({ daysSilent: 1 })])).toEqual([]);
    expect(needsAttention([standing({ daysSilent: 2 })])).toHaveLength(1);
  });
});
