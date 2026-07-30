import { describe, expect, it } from 'vitest';
import {
  draftKey,
  emptyDraft,
  evaluateDraft,
  isComplete,
  medReferences,
  offersMed,
  setMedOption,
  setStatus,
  toPayload,
  toResults,
  unanswered,
  type ProtocolWithMed,
} from '@/features/forge/sitrep-draft';

/**
 * The draft model.
 *
 * Three of these tests exist because of a specific consequence rather than for coverage:
 *
 *  - the single-option auto-select is most of the sixty-second budget;
 *  - clearing `medOptionId` when leaving `med_pass` mirrors a SQL CHECK, so getting it wrong
 *    means every affected write bounces off the database;
 *  - `toPayload` returning null for an incomplete day is what stops a partial day being filed
 *    as a complete one.
 */

function protocol(overrides: Partial<ProtocolWithMed> & { slug: string }): ProtocolWithMed {
  return {
    id: `id-${overrides.slug}`,
    label: overrides.slug,
    nickname: null,
    kind: 'duty',
    activatesOnDay: 1,
    isTreasonTrigger: false,
    visibility: 'itemised',
    medOptions: [],
    ...overrides,
  };
}

const MORNING = protocol({
  slug: 'morning-protocol',
  label: 'Morning Protocol',
  nickname: 'The 5-Minute Victory',
  medOptions: [
    {
      id: 'med-morning',
      label: 'The 5-Minute Victory',
      body: 'Go to the Command Post, drink one full glass of water, read the Top G Code aloud, perform 20 push-ups.',
    },
  ],
});

const FORGING = protocol({
  slug: 'physical-forging',
  label: 'Physical Forging',
  activatesOnDay: 4,
  medOptions: [
    { id: 'med-a', label: 'Option A', body: '100 push-ups and 200 bodyweight squats.' },
    { id: 'med-b', label: 'Option B', body: 'A 20-minute non-stop run or brisk walk.' },
  ],
});

const OATH = protocol({
  slug: 'sexual-discipline',
  label: 'Sexual discipline',
  kind: 'prohibition',
  isTreasonTrigger: true,
  visibility: 'aggregate_only',
});

const GAMES = protocol({ slug: 'video-games', kind: 'prohibition' });

describe('offersMed', () => {
  it('is true for a protocol with a minimum effective dose', () => {
    expect(offersMed(MORNING)).toBe(true);
    expect(offersMed(FORGING)).toBe(true);
  });

  it('is false for a prohibition, which has no reduced version', () => {
    expect(offersMed(OATH)).toBe(false);
    expect(offersMed(GAMES)).toBe(false);
  });
});

describe('setStatus', () => {
  it('selects the only MED automatically', () => {
    // The budget test. A tap per protocol per day, for a choice with one answer, is most of
    // sixty seconds.
    const draft = setStatus(emptyDraft(), MORNING, 'med_pass');
    expect(draft['morning-protocol']).toEqual({ status: 'med_pass', medOptionId: 'med-morning' });
  });

  it('does not guess when there is a genuine choice', () => {
    const draft = setStatus(emptyDraft(), FORGING, 'med_pass');
    expect(draft['physical-forging']).toEqual({ status: 'med_pass', medOptionId: null });
  });

  it('clears the MED option when moving to a full pass', () => {
    // Mirror: protocol_results_med_option_only_for_med_pass. Leaving it set makes the write
    // bounce, and claims he did the minimum on a day he did the whole thing.
    const chosen = setMedOption(emptyDraft(), 'physical-forging', 'med-b');
    const promoted = setStatus(chosen, FORGING, 'pass');
    expect(promoted['physical-forging']).toEqual({ status: 'pass', medOptionId: null });
  });

  it('clears the MED option when moving to a fail', () => {
    const chosen = setMedOption(emptyDraft(), 'physical-forging', 'med-b');
    const failed = setStatus(chosen, FORGING, 'fail');
    expect(failed['physical-forging']).toEqual({ status: 'fail', medOptionId: null });
  });

  it('keeps an explicit choice when med_pass is re-selected', () => {
    const chosen = setMedOption(emptyDraft(), 'physical-forging', 'med-b');
    const again = setStatus(chosen, FORGING, 'med_pass');
    expect(again['physical-forging']?.medOptionId).toBe('med-b');
  });

  it('does not disturb other protocols', () => {
    const draft = setStatus(setStatus(emptyDraft(), MORNING, 'pass'), GAMES, 'fail');
    expect(draft['morning-protocol']?.status).toBe('pass');
    expect(draft['video-games']?.status).toBe('fail');
  });

  it('does not mutate the draft it is given', () => {
    const before = setStatus(emptyDraft(), MORNING, 'pass');
    const snapshot = structuredClone(before);
    setStatus(before, MORNING, 'fail');
    expect(before).toEqual(snapshot);
  });
});

describe('setMedOption', () => {
  it('implies a MED pass', () => {
    const draft = setMedOption(emptyDraft(), 'physical-forging', 'med-a');
    expect(draft['physical-forging']).toEqual({ status: 'med_pass', medOptionId: 'med-a' });
  });

  it('replaces a previous choice rather than accumulating', () => {
    const draft = setMedOption(
      setMedOption(emptyDraft(), 'physical-forging', 'med-a'),
      'physical-forging',
      'med-b',
    );
    expect(draft['physical-forging']?.medOptionId).toBe('med-b');
  });
});

describe('unanswered', () => {
  const all = [MORNING, FORGING, OATH, GAMES];

  it('lists only protocols that are active on the day', () => {
    // Physical Forging activates on day 4 and must not be listed on day 1 — a protocol that is
    // not live cannot be failed and must not be offered.
    expect(unanswered(emptyDraft(), all, 1).map((p) => p.slug)).toEqual([
      'morning-protocol',
      'sexual-discipline',
      'video-games',
    ]);
    expect(unanswered(emptyDraft(), all, 4)).toHaveLength(4);
  });

  it('treats a multi-option MED pass with no choice as unanswered', () => {
    const draft = setStatus(emptyDraft(), FORGING, 'med_pass');
    expect(unanswered(draft, [FORGING], 4).map((p) => p.slug)).toEqual(['physical-forging']);
  });

  it('accepts it once the option is named', () => {
    const draft = setMedOption(setStatus(emptyDraft(), FORGING, 'med_pass'), 'physical-forging', 'med-a');
    expect(unanswered(draft, [FORGING], 4)).toEqual([]);
  });

  it('accepts a single-option MED pass immediately', () => {
    const draft = setStatus(emptyDraft(), MORNING, 'med_pass');
    expect(unanswered(draft, [MORNING], 1)).toEqual([]);
  });
});

describe('isComplete', () => {
  it('is false while anything active is unanswered', () => {
    const draft = setStatus(emptyDraft(), MORNING, 'pass');
    expect(isComplete(draft, [MORNING, GAMES], 1)).toBe(false);
  });

  it('is true when every active protocol has an answer', () => {
    const draft = setStatus(setStatus(emptyDraft(), MORNING, 'pass'), GAMES, 'pass');
    expect(isComplete(draft, [MORNING, GAMES], 1)).toBe(true);
  });

  it('ignores answers for protocols that are not active yet', () => {
    const draft = setStatus(setStatus(emptyDraft(), MORNING, 'pass'), GAMES, 'pass');
    // Physical Forging is inactive on day 1, so its silence does not block the day.
    expect(isComplete(draft, [MORNING, GAMES, FORGING], 1)).toBe(true);
  });
});

describe('toResults', () => {
  it('omits inactive protocols rather than defaulting them', () => {
    const draft = setStatus(setStatus(emptyDraft(), MORNING, 'pass'), FORGING, 'fail');
    expect(toResults(draft, [MORNING, FORGING], 1)).toEqual([
      { slug: 'morning-protocol', status: 'pass' },
    ]);
  });

  it('omits unanswered protocols rather than reading silence as a pass', () => {
    const draft = setStatus(emptyDraft(), MORNING, 'pass');
    expect(toResults(draft, [MORNING, GAMES], 1)).toEqual([
      { slug: 'morning-protocol', status: 'pass' },
    ]);
  });
});

describe('evaluateDraft', () => {
  const all = [MORNING, OATH, GAMES];

  it('reports what is missing while the day is unfinished', () => {
    const evaluation = evaluateDraft({ draft: setStatus(emptyDraft(), MORNING, 'pass'), protocols: all, day: 1 });
    expect(evaluation).toEqual({ kind: 'incomplete', missing: ['sexual-discipline', 'video-games'] });
  });

  it('counts a MED pass as a complete day', () => {
    let draft = setStatus(emptyDraft(), MORNING, 'med_pass');
    draft = setStatus(draft, OATH, 'pass');
    draft = setStatus(draft, GAMES, 'pass');
    const evaluation = evaluateDraft({ draft, protocols: all, day: 1 });
    expect(evaluation).toMatchObject({ kind: 'evaluated', outcome: 'complete', medPassed: ['morning-protocol'] });
  });

  it('names a treason trigger as treason, not as a tactical failure', () => {
    let draft = setStatus(emptyDraft(), MORNING, 'pass');
    draft = setStatus(draft, OATH, 'fail');
    draft = setStatus(draft, GAMES, 'pass');
    expect(evaluateDraft({ draft, protocols: all, day: 1 })).toMatchObject({
      outcome: 'reset',
      resetKind: 'treason',
    });
  });

  it('honours a ruleset passed through', () => {
    let draft = setStatus(emptyDraft(), MORNING, 'fail');
    draft = setStatus(draft, OATH, 'pass');
    draft = setStatus(draft, GAMES, 'fail');
    expect(
      evaluateDraft({ draft, protocols: all, day: 1, ruleset: { zeroDayThreshold: 2 } }),
    ).toMatchObject({ outcome: 'reset', resetKind: 'zero_day' });
    expect(evaluateDraft({ draft, protocols: all, day: 1 })).toMatchObject({ outcome: 'repeat' });
  });
});

describe('toPayload', () => {
  const all = [MORNING, OATH, GAMES];

  function complete(): ReturnType<typeof setStatus> {
    let draft = setStatus(emptyDraft(), MORNING, 'med_pass');
    draft = setStatus(draft, OATH, 'pass');
    draft = setStatus(draft, GAMES, 'pass');
    return draft;
  }

  it('refuses an incomplete day', () => {
    // The reason this returns null rather than filing what it has: a day filed with two of
    // three protocols answered would be recorded as complete, and the missing one would read
    // as held. Silence is not a pass.
    const payload = toPayload({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      draft: setStatus(emptyDraft(), MORNING, 'pass'),
      protocols: all,
      day: 1,
    });
    expect(payload).toBeNull();
  });

  it('derives the final status from the doctrine, not from a caller', () => {
    const payload = toPayload({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      draft: complete(),
      protocols: all,
      day: 1,
    });
    expect(payload).toMatchObject({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      finalStatus: 'complete',
      resetKind: null,
      protocolsFailed: [],
    });
  });

  it('carries the MED option through to the write', () => {
    const draft = setMedOption(complete(), 'physical-forging', 'med-b');
    const payload = toPayload({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      draft: { ...draft, 'sexual-discipline': { status: 'pass', medOptionId: null } },
      protocols: [...all, FORGING],
      day: 4,
    });
    expect(payload?.results).toContainEqual({
      protocolId: 'id-physical-forging',
      status: 'med_pass',
      medOptionId: 'med-b',
    });
    expect(payload?.results).toContainEqual({
      protocolId: 'id-morning-protocol',
      status: 'med_pass',
      medOptionId: 'med-morning',
    });
  });

  it('reports the reset kind and the failed slugs for a reset', () => {
    let draft = setStatus(emptyDraft(), MORNING, 'pass');
    draft = setStatus(draft, OATH, 'fail');
    draft = setStatus(draft, GAMES, 'pass');
    const payload = toPayload({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      draft,
      protocols: all,
      day: 9,
    });
    expect(payload).toMatchObject({
      finalStatus: 'reset',
      resetKind: 'treason',
      protocolsFailed: ['sexual-discipline'],
    });
  });

  it('excludes protocols that are not active on the day', () => {
    const payload = toPayload({
      enrollmentId: 'enr-1',
      localDate: '2026-07-30',
      draft: { ...complete(), 'physical-forging': { status: 'fail', medOptionId: null } },
      protocols: [...all, FORGING],
      day: 1,
    });
    expect(payload?.results.map((r) => r.protocolId)).not.toContain('id-physical-forging');
    // And the inactive fail must not have coloured the outcome.
    expect(payload?.finalStatus).toBe('complete');
  });
});

describe('draftKey', () => {
  it('is one slot per enrollment per day', () => {
    expect(draftKey('enr-1', '2026-07-30')).toBe('sitrep:enr-1:2026-07-30');
    expect(draftKey('enr-1', '2026-07-30')).toBe(draftKey('enr-1', '2026-07-30'));
    expect(draftKey('enr-1', '2026-07-31')).not.toBe(draftKey('enr-1', '2026-07-30'));
    expect(draftKey('enr-2', '2026-07-30')).not.toBe(draftKey('enr-1', '2026-07-30'));
  });
});

describe('medReferences', () => {
  it('finds the Top G Code in the Morning Protocol MED', () => {
    const body = MORNING.medOptions[0]?.body ?? '';
    expect(medReferences(body)).toEqual({
      topGCode: true,
      commandPost: true,
      fortressProtocol: false,
    });
  });

  it('finds the Fortress Protocol in the Deep Work MED', () => {
    expect(
      medReferences(
        'One 25-minute completely uninterrupted Pomodoro on the most important task, under Fortress Protocol rules.',
      ),
    ).toEqual({ topGCode: false, commandPost: false, fortressProtocol: true });
  });

  it('finds nothing in a MED that references nothing', () => {
    expect(medReferences('A 20-minute non-stop run or brisk walk.')).toEqual({
      topGCode: false,
      commandPost: false,
      fortressProtocol: false,
    });
  });
});
