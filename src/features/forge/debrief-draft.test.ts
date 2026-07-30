import { describe, expect, it } from 'vitest';
import {
  ATTACK_OUTCOMES,
  PATTERN_MINIMUM,
  TRIGGER_KINDS,
  TRIGGER_LABELS,
  OUTCOME_LABELS,
  attackPattern,
  blockers,
  debriefKey,
  emptyDebrief,
  formatHour,
  insightState,
  isComplete,
  localHour,
  toPayload,
  type AttackRecord,
  type DebriefDraft,
} from '@/features/forge/debrief-draft';

/**
 * The debrief model.
 *
 * Two things here are worth more than the rest. `localHour` decides the value of the column the
 * whole feature exists to aggregate, and it is wrong in a way nobody notices — a man travelling
 * files a 15:00 ambush as 20:00 and the histogram quietly stops meaning anything. And
 * `attackPattern` decides when the app is allowed to *claim* a pattern, which is the difference
 * between intelligence and a horoscope.
 *
 * The suite runs under TZ=America/New_York (vitest.config.ts), so a function that leaned on the
 * host clock could not pass the cases below by accident.
 */

function draft(overrides: Partial<DebriefDraft> = {}): DebriefDraft {
  return { ...emptyDebrief(), ...overrides };
}

describe('localHour', () => {
  it('reports the hour where he is, not where the server is', () => {
    // 2026-07-30T19:30Z is 15:30 in New York and 21:30 in Berlin. Same instant, three answers,
    // and only one of them is the hour the ambush happened for him.
    const at = new Date('2026-07-30T19:30:00Z');
    expect(localHour('America/New_York', at)).toBe(15);
    expect(localHour('Europe/Berlin', at)).toBe(21);
    expect(localHour('UTC', at)).toBe(19);
    expect(localHour('Asia/Kolkata', at)).toBe(1); // +05:30, so it is already tomorrow
  });

  it('handles the hour rolling into the previous day', () => {
    const at = new Date('2026-07-30T02:30:00Z');
    expect(localHour('America/New_York', at)).toBe(22); // 22:30 on the 29th
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // New York is UTC-5 in January and UTC-4 in July. A hardcoded offset gets one of these wrong,
    // which is a silent one-hour skew across half the year.
    expect(localHour('America/New_York', new Date('2026-01-15T18:00:00Z'))).toBe(13);
    expect(localHour('America/New_York', new Date('2026-07-15T18:00:00Z'))).toBe(14);
  });

  it('always lands in range', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.UTC(2026, 6, 30, hour, 0, 0));
      for (const zone of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']) {
        const result = localHour(zone, at);
        expect(result, `${zone} at ${hour}Z`).toBeGreaterThanOrEqual(0);
        expect(result, `${zone} at ${hour}Z`).toBeLessThanOrEqual(23);
      }
    }
  });
});

describe('the enums mirror the database', () => {
  it('lists the nine triggers from DOCTRINE §6.2', () => {
    // Mirror: public.bottom_g_trigger in 0005_debrief.sql. Adding one here without adding it
    // there makes every write with the new value bounce.
    expect(TRIGGER_KINDS).toEqual([
      'low_energy',
      'stress',
      'boredom',
      'loneliness',
      'fatigue',
      'celebration',
      'social_pressure',
      'frustration',
      'other',
    ]);
  });

  it('gives every trigger and outcome a label', () => {
    for (const kind of TRIGGER_KINDS) expect(TRIGGER_LABELS[kind]).toBeTruthy();
    for (const outcome of ATTACK_OUTCOMES) expect(OUTCOME_LABELS[outcome]).toBeTruthy();
  });

  it('names outcomes from his side of the fight', () => {
    // "Resisted" as a database value, "I held" on the screen. The screen is talking to a man
    // about his own day, not reporting a status code.
    expect(OUTCOME_LABELS.resisted).toBe('I held');
    expect(OUTCOME_LABELS.lost).toBe('It won');
  });
});

describe('insightState', () => {
  it('is empty when neither field is filled', () => {
    expect(insightState(draft())).toBe('empty');
  });

  it('is partial with only one half', () => {
    expect(insightState(draft({ systemUsed: 'Laid clothes out' }))).toBe('partial');
    expect(insightState(draft({ victory: 'Out the door' }))).toBe('partial');
  });

  it('is complete with both', () => {
    expect(insightState(draft({ systemUsed: 'Laid clothes out', victory: 'Out the door' }))).toBe(
      'complete',
    );
  });

  it('treats whitespace as empty', () => {
    expect(insightState(draft({ systemUsed: '   ', victory: '  ' }))).toBe('empty');
    expect(insightState(draft({ systemUsed: '  ', victory: 'Out the door' }))).toBe('partial');
  });
});

describe('blockers', () => {
  it('always requires the attack question to be answered', () => {
    // Mirror: debriefs.attacked is NOT NULL. Silence and "no attack" are different facts, and a
    // schema that cannot tell them apart loses the denominator for every rate in §6.3.
    expect(blockers(draft())).toContain('Say whether the Bottom G attacked today.');
  });

  it('accepts a day with no attack and no insight', () => {
    // A quiet day is a legitimate, complete debrief. Requiring an insight every single day is how
    // a man starts inventing them, and invented intelligence is worse than none.
    expect(blockers(draft({ attacked: false }))).toEqual([]);
    expect(isComplete(draft({ attacked: false }))).toBe(true);
  });

  it('names which half of the insight is missing', () => {
    expect(blockers(draft({ attacked: false, systemUsed: 'Laid clothes out' }))).toEqual([
      'Name what the system actually won you.',
    ]);
    expect(blockers(draft({ attacked: false, victory: 'Out the door' }))).toEqual([
      'Name the system that produced the victory.',
    ]);
  });

  it('requires the hour and the outcome once he says he was attacked', () => {
    const reasons = blockers(draft({ attacked: true }));
    expect(reasons).toContain('Say what hour the attack landed.');
    expect(reasons).toContain('Say how it went.');
  });

  it('is satisfied by an hour and an outcome', () => {
    expect(blockers(draft({ attacked: true, occurredAtHour: 15, outcome: 'lost' }))).toEqual([]);
  });

  it('accepts hour zero', () => {
    // The obvious off-by-one: midnight is falsy. A 00:00 attack is a real and interesting one.
    expect(blockers(draft({ attacked: true, occurredAtHour: 0, outcome: 'lost' }))).toEqual([]);
  });

  it('rejects an over-long field', () => {
    // Mirror: app.capped_text_140. Caught here so he gets a fast error rather than a round trip.
    const long = 'x'.repeat(141);
    expect(blockers(draft({ attacked: false, systemUsed: long, victory: 'ok' }))).toContain(
      'The system is over 140 characters.',
    );
    expect(
      blockers(draft({ attacked: true, occurredAtHour: 9, outcome: 'lost', propaganda: long })),
    ).toContain('The propaganda is over 140 characters.');
  });

  it('does not ask about propaganda length on a day with no attack', () => {
    expect(blockers(draft({ attacked: false, propaganda: 'x'.repeat(200) }))).toEqual([]);
  });
});

describe('toPayload', () => {
  it('refuses an incomplete debrief', () => {
    expect(toPayload('s1', draft(), null)).toBeNull();
    expect(toPayload('s1', draft({ attacked: true, occurredAtHour: 9 }), 'stress')).toBeNull();
  });

  it('refuses an attack with no trigger named', () => {
    expect(
      toPayload('s1', draft({ attacked: true, occurredAtHour: 9, outcome: 'lost' }), null),
    ).toBeNull();
  });

  it('carries a full debrief through', () => {
    const payload = toPayload(
      's1',
      draft({
        systemUsed: 'Laid gym clothes out the night before',
        victory: 'Out the door before he could negotiate',
        insightProtocolId: 'p-forging',
        attacked: true,
        occurredAtHour: 15,
        outcome: 'lost',
        propaganda: 'You need a quick boost',
        attackedProtocolId: 'p-junk',
      }),
      'low_energy',
    );
    expect(payload).toEqual({
      sitrepId: 's1',
      attacked: true,
      systemUsed: 'Laid gym clothes out the night before',
      victory: 'Out the door before he could negotiate',
      insightProtocolId: 'p-forging',
      outcome: 'lost',
      occurredAtHour: 15,
      triggerKind: 'low_energy',
      propaganda: 'You need a quick boost',
      attackedProtocolId: 'p-junk',
    });
  });

  it('clears every attack field when there was no attack', () => {
    // Mirror: debriefs_outcome_iff_attacked rejects an outcome without an attack, and
    // file_debrief deletes the tactic row. Leaving them set makes the write bounce.
    const payload = toPayload(
      's1',
      draft({
        attacked: false,
        outcome: 'lost',
        occurredAtHour: 15,
        propaganda: 'stale',
        attackedProtocolId: 'p-junk',
      }),
      'stress',
    );
    expect(payload).toMatchObject({
      attacked: false,
      outcome: null,
      occurredAtHour: null,
      triggerKind: null,
      propaganda: null,
      attackedProtocolId: null,
    });
  });

  it('sends null rather than an empty string', () => {
    const payload = toPayload('s1', draft({ attacked: false, systemUsed: '  ', victory: '  ' }), null);
    expect(payload?.systemUsed).toBeNull();
    expect(payload?.victory).toBeNull();
  });
});

describe('debriefKey', () => {
  it('is one slot per day', () => {
    expect(debriefKey('s1')).toBe('debrief:s1');
    expect(debriefKey('s1')).not.toBe(debriefKey('s2'));
  });
});

describe('attackPattern', () => {
  function attack(hour: number, kind: AttackRecord['triggerKind'], outcome: AttackRecord['outcome'] = 'lost'): AttackRecord {
    return { occurredAtHour: hour, triggerKind: kind, outcome };
  }

  it('claims no pattern below the minimum', () => {
    // One incident dressed up as intelligence is how a man learns to ignore this screen.
    const records = Array.from({ length: PATTERN_MINIMUM - 1 }, () => attack(15, 'low_energy'));
    expect(attackPattern(records).peakWindow).toBeNull();
    expect(attackPattern(records).total).toBe(PATTERN_MINIMUM - 1);
  });

  it('finds the window once there is enough', () => {
    const records = [
      attack(14, 'low_energy'),
      attack(15, 'low_energy'),
      attack(15, 'stress'),
      attack(16, 'low_energy'),
      attack(9, 'boredom'),
    ];
    const pattern = attackPattern(records);
    expect(pattern.peakWindow).toEqual({ from: 14, to: 16, share: 4 / 5 });
  });

  it('refuses to name a window the attacks are spread across', () => {
    // Scattered attacks are a real finding — "there is no pattern yet" — and dressing them up as
    // one is the horoscope failure mode.
    const records = [
      attack(1, 'stress'),
      attack(7, 'stress'),
      attack(12, 'stress'),
      attack(17, 'stress'),
      attack(22, 'stress'),
      attack(4, 'stress'),
    ];
    expect(attackPattern(records).peakWindow).toBeNull();
  });

  it('wraps a window across midnight', () => {
    const records = [
      attack(23, 'fatigue'),
      attack(23, 'fatigue'),
      attack(0, 'fatigue'),
      attack(1, 'fatigue'),
      attack(12, 'boredom'),
    ];
    expect(attackPattern(records).peakWindow).toMatchObject({ from: 23, to: 1 });
  });

  it('counts the hours regardless of how few there are', () => {
    // The histogram is always honest even when the claim is withheld.
    const pattern = attackPattern([attack(15, 'low_energy'), attack(15, 'stress')]);
    expect(pattern.byHour[15]).toBe(2);
    expect(pattern.byHour[3]).toBe(0);
    expect(pattern.peakWindow).toBeNull();
  });

  it('ranks triggers by how often they beat him, worst first', () => {
    const records = [
      attack(15, 'low_energy', 'lost'),
      attack(15, 'low_energy', 'lost'),
      attack(16, 'low_energy', 'resisted'),
      attack(9, 'stress', 'resisted'),
      attack(9, 'stress', 'resisted'),
      attack(9, 'stress', 'lost'),
    ];
    const pattern = attackPattern(records);
    expect(pattern.byTrigger[0]).toEqual({ kind: 'low_energy', attacks: 3, losses: 2 });
    expect(pattern.byTrigger[1]).toEqual({ kind: 'stress', attacks: 3, losses: 1 });
  });

  it('counts a partial as a loss', () => {
    // He gave ground. A metric that only counts total defeats flatters him at exactly the point
    // he needs the truth.
    const pattern = attackPattern([attack(15, 'boredom', 'partial')]);
    expect(pattern.byTrigger[0]).toEqual({ kind: 'boredom', attacks: 1, losses: 1 });
  });

  it('handles an empty record without inventing anything', () => {
    const pattern = attackPattern([]);
    expect(pattern).toEqual({
      total: 0,
      byHour: Array.from({ length: 24 }, () => 0),
      peakWindow: null,
      byTrigger: [],
    });
  });
});

describe('formatHour', () => {
  it('pads so a column compares', () => {
    expect(formatHour(0)).toBe('00:00');
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(15)).toBe('15:00');
    expect(formatHour(23)).toBe('23:00');
  });
});
