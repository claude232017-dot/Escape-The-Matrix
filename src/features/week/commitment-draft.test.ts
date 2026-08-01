import { describe, expect, it } from 'vitest';
import {
  BODY_CAP,
  MAX_COMMITMENTS,
  blockers,
  canDeclare,
  canSettle,
  canWithdraw,
  declareKey,
  isDeclarationDay,
  settleKey,
  tally,
  toPayload,
  weekPhase,
  weekStartFor,
  type Commitment,
  type WeekView,
} from '@/features/week/commitment-draft';

// 2026-07-27 is a Monday; 2026-08-02 the Sunday closing that week.
const MONDAY = '2026-07-27';
const WEDNESDAY = '2026-07-29';
const SATURDAY = '2026-08-01';
const SUNDAY = '2026-08-02';
const NEXT_MONDAY = '2026-08-03';

function commitment(over: Partial<Commitment> = {}): Commitment {
  return { id: 'c1', body: 'Ten sales calls', outcome: 'pending', declaredOn: MONDAY, ...over };
}

function view(over: Partial<WeekView> = {}): WeekView {
  return { weekStart: MONDAY, commitments: [], ...over };
}

describe('the week phase', () => {
  it('opens the slate on an empty live week', () => {
    expect(weekPhase(view(), MONDAY)).toBe('declare');
    expect(weekPhase(view(), SATURDAY)).toBe('declare');
  });

  it('says there is nothing to do once he has declared and the week is running', () => {
    // The honest answer mid-week. Nothing to press, nothing to update — the work is the point,
    // and a screen that invents an interaction here is inventing busywork.
    expect(weekPhase(view({ commitments: [commitment()] }), WEDNESDAY)).toBe('live');
  });

  it('opens settling on Sunday, not before', () => {
    const declared = view({ commitments: [commitment()] });
    expect(weekPhase(declared, SATURDAY)).toBe('live');
    expect(weekPhase(declared, SUNDAY)).toBe('settle');
    expect(weekPhase(declared, NEXT_MONDAY)).toBe('settle');
  });

  it('is settled only when every commitment has an answer', () => {
    const half = view({
      commitments: [commitment({ id: 'a', outcome: 'hit' }), commitment({ id: 'b' })],
    });
    expect(weekPhase(half, SUNDAY)).toBe('settle');

    const done = view({
      commitments: [
        commitment({ id: 'a', outcome: 'hit' }),
        commitment({ id: 'b', outcome: 'missed' }),
      ],
    });
    expect(weekPhase(done, SUNDAY)).toBe('settled');
  });

  it('names a week that passed with nothing declared', () => {
    // Not a prompt to go back and declare — that week is gone, and §8 does not allow
    // back-dating. It is a fact about him, stated once and left alone.
    expect(weekPhase(view(), SUNDAY)).toBe('missed-the-week');
    expect(weekPhase(view(), NEXT_MONDAY)).toBe('missed-the-week');
  });
});

describe('what he may do', () => {
  it('lets him fill the slate up to three', () => {
    expect(canDeclare(view(), WEDNESDAY)).toBe(true);
    expect(canDeclare(view({ commitments: [commitment(), commitment({ id: 'b' })] }), WEDNESDAY))
      .toBe(true);
    const full = view({
      commitments: [commitment(), commitment({ id: 'b' }), commitment({ id: 'c' })],
    });
    expect(canDeclare(full, WEDNESDAY)).toBe(false);
  });

  it('closes declaring once the week is over', () => {
    // Mirror: the insert policy requires `week_start = app.week_start_for(profile_id)`, so a
    // late declaration is refused by the database too. This is the fast, local half.
    expect(canDeclare(view(), SATURDAY)).toBe(true);
    expect(canDeclare(view(), SUNDAY)).toBe(false);
  });

  it('allows a same-day withdrawal and nothing later', () => {
    // The typo escape hatch. By tomorrow the commitment stands whatever he now thinks of it —
    // which is the whole mechanism, so this is the boundary that matters most on this screen.
    expect(canWithdraw(commitment({ declaredOn: MONDAY }), MONDAY)).toBe(true);
    expect(canWithdraw(commitment({ declaredOn: MONDAY }), WEDNESDAY)).toBe(false);
  });

  it('refuses to withdraw something already settled', () => {
    expect(canWithdraw(commitment({ outcome: 'hit', declaredOn: MONDAY }), MONDAY)).toBe(false);
  });

  it('opens settling on Sunday and never closes it', () => {
    // A man who was away has to be able to close out an old week; refusing him would leave a
    // permanently pending row. Mirror: app.enforce_commitment_windows().
    expect(canSettle(view(), SATURDAY)).toBe(false);
    expect(canSettle(view(), SUNDAY)).toBe(true);
    expect(canSettle(view(), '2026-09-01')).toBe(true);
  });
});

describe('blockers', () => {
  it('passes a good slate', () => {
    expect(blockers(['Ten sales calls', 'Ship the landing page'])).toEqual([]);
  });

  it('refuses an empty slate', () => {
    expect(blockers([])).toContain('Write at least one commitment.');
    expect(blockers(['', '   '])).toContain('Write at least one commitment.');
  });

  it('refuses a fourth', () => {
    // Mirror: app.enforce_commitment_ceiling(), which is what makes it true.
    const reasons = blockers(['One', 'Two', 'Three', 'Four']);
    expect(reasons.some((r) => r.includes('Three is the cap'))).toBe(true);
  });

  it('refuses one longer than the cap', () => {
    expect(blockers(['x'.repeat(BODY_CAP + 1)]).some((r) => r.includes('140'))).toBe(true);
    expect(blockers(['x'.repeat(BODY_CAP)])).toEqual([]);
  });

  it('refuses two that are the same commitment', () => {
    // Two identical entries are one commitment and a wasted slot. Case-insensitive, because
    // "Ten sales calls" and "ten sales calls" are the same promise.
    expect(blockers(['Ten sales calls', 'ten sales calls'])).toContain(
      'Two of these are the same commitment.',
    );
  });

  it('ignores blanks when counting toward the cap', () => {
    expect(blockers(['One', '', 'Two', '   ', 'Three'])).toEqual([]);
  });
});

describe('toPayload', () => {
  it('returns null for a slate that is not sendable', () => {
    expect(toPayload(MONDAY, [])).toBeNull();
    expect(toPayload(MONDAY, ['a', 'a'])).toBeNull();
  });

  it('trims and drops blanks', () => {
    expect(toPayload(MONDAY, ['  Ten sales calls  ', '', 'Ship it'])).toEqual({
      weekStart: MONDAY,
      bodies: ['Ten sales calls', 'Ship it'],
    });
  });

  it('keeps the order he wrote them in', () => {
    // Not sorted. The first one is the one he thought of first, and on a screen that is a
    // priority whether or not anyone calls it one.
    expect(toPayload(MONDAY, ['Third thing', 'First thing'])?.bodies).toEqual([
      'Third thing',
      'First thing',
    ]);
  });
});

describe('outbox keys', () => {
  it('gives one slot per member-week, so a retried slate replaces', () => {
    expect(declareKey(MONDAY)).toBe(declareKey(MONDAY));
    expect(declareKey(MONDAY)).not.toBe(declareKey(NEXT_MONDAY));
  });

  it('gives one slot per commitment, so settling three does not coalesce into one', () => {
    // The bug this prevents: latest-wins coalescing on a shared key would mean answering three
    // commitments offline arrives as one answer.
    expect(settleKey('a')).not.toBe(settleKey('b'));
  });
});

describe('tally', () => {
  it('counts, and does not score', () => {
    // §1 rules out gamification. No percentage, no streak, nothing that goes up.
    expect(
      tally([
        commitment({ id: 'a', outcome: 'hit' }),
        commitment({ id: 'b', outcome: 'hit' }),
        commitment({ id: 'c', outcome: 'missed' }),
      ]),
    ).toEqual({ hit: 2, missed: 1, pending: 0, total: 3 });
  });

  it('handles an empty week without dividing by anything', () => {
    expect(tally([])).toEqual({ hit: 0, missed: 0, pending: 0, total: 0 });
  });
});

describe('the week boundary', () => {
  it('agrees with DOCTRINE §8 on which day starts the week', () => {
    // Mirror: app.week_start_for() in 0008_commitments.sql. Both must answer with the same
    // Monday for the same member at the same instant.
    expect(weekStartFor(WEDNESDAY)).toBe(MONDAY);
    expect(weekStartFor(MONDAY)).toBe(MONDAY);
    expect(weekStartFor(SUNDAY)).toBe(MONDAY);
    expect(weekStartFor(NEXT_MONDAY)).toBe(NEXT_MONDAY);
  });

  it('knows which day is the ritual', () => {
    expect(isDeclarationDay(MONDAY)).toBe(true);
    expect(isDeclarationDay(WEDNESDAY)).toBe(false);
  });

  it('caps the slate at the number DOCTRINE §8 states', () => {
    expect(MAX_COMMITMENTS).toBe(3);
  });
});
