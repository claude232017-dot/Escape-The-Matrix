import { offsetMsAt } from '@/lib/date';

/**
 * The debrief, as a value.
 *
 * The blank page is what this replaces. Two prose paragraphs a day, times twelve men, times
 * thirty days, is seven hundred reports nobody can query — so the thinking is kept and the
 * textarea is not (ADR-001). Everything here is an enum, a capped field, or a number.
 *
 * Pure and separate from the screen, because the rules below are not presentation: what counts as
 * a complete debrief, and what hour of the day it was, are both things a wrong answer corrupts
 * quietly.
 */

/** DOCTRINE §6.2. Mirror: the SQL enum `public.bottom_g_trigger` in 0005_debrief.sql. */
export const TRIGGER_KINDS = [
  'low_energy',
  'stress',
  'boredom',
  'loneliness',
  'fatigue',
  'celebration',
  'social_pressure',
  'frustration',
  'other',
] as const;

export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** Mirror: the SQL enum `public.attack_outcome`. */
export const ATTACK_OUTCOMES = ['resisted', 'partial', 'lost'] as const;
export type AttackOutcome = (typeof ATTACK_OUTCOMES)[number];

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  low_energy: 'Low energy',
  stress: 'Stress',
  boredom: 'Boredom',
  loneliness: 'Loneliness',
  fatigue: 'Fatigue',
  celebration: 'Celebration',
  social_pressure: 'Social pressure',
  frustration: 'Frustration',
  other: 'Something else',
};

export const OUTCOME_LABELS: Record<AttackOutcome, string> = {
  // Named from his side of the fight, not the enemy's. "Resisted" is a thing he did.
  resisted: 'I held',
  partial: 'Partly',
  lost: 'It won',
};

/** Mirror: `app.capped_text_140`. The client cap exists to give a fast error, not to enforce. */
export const FIELD_CAP = 140;

export interface DebriefDraft {
  /** The Top G Insight. Both or neither — half of a causal claim is not intelligence. */
  systemUsed: string;
  victory: string;
  insightProtocolId: string | null;

  /** Null means he has not answered yet, which is not the same as "no attack". */
  attacked: boolean | null;
  outcome: AttackOutcome | null;
  occurredAtHour: number | null;
  propaganda: string;
  attackedProtocolId: string | null;
}

export function emptyDebrief(): DebriefDraft {
  return {
    systemUsed: '',
    victory: '',
    insightProtocolId: null,
    attacked: null,
    outcome: null,
    occurredAtHour: null,
    propaganda: '',
    attackedProtocolId: null,
  };
}

/**
 * The hour it currently is, where he is.
 *
 * "The single most valuable column in the schema" is only valuable if it is his hour. Derived
 * through the same offset machinery as every other date in this codebase rather than from
 * `getHours()`, which would report the hour of whatever machine the browser is running on — and a
 * man travelling would file a 15:00 ambush as 20:00, quietly poisoning the one aggregate the
 * feature exists to produce.
 *
 * Mirror note: the SQL side is `bottom_g_tactics.occurred_at_hour`, stored as a plain 0–23
 * integer precisely so the timezone question is settled here, on the way in.
 */
export function localHour(timezone: string, at: Date = new Date()): number {
  const shifted = new Date(at.getTime() + offsetMsAt(at, timezone));
  return shifted.getUTCHours();
}

/**
 * Whether the insight half is answered.
 *
 * Both fields or neither. Mirror: the SQL constraint `debriefs_insight_paired`. A system with no
 * victory is a habit; a victory with no system is a feeling. The pair is the causal link, and the
 * link is the only part worth aggregating.
 */
export function insightState(draft: DebriefDraft): 'empty' | 'partial' | 'complete' {
  const system = draft.systemUsed.trim();
  const victory = draft.victory.trim();
  if (system === '' && victory === '') return 'empty';
  return system !== '' && victory !== '' ? 'complete' : 'partial';
}

/**
 * What still stops this debrief being filed.
 *
 * Returns the reasons rather than a boolean so the screen can say which one — "something is
 * missing" on a form with seven fields is a puzzle, not an error message.
 */
export function blockers(draft: DebriefDraft): string[] {
  const reasons: string[] = [];

  if (insightState(draft) === 'partial') {
    reasons.push(
      draft.systemUsed.trim() === ''
        ? 'Name the system that produced the victory.'
        : 'Name what the system actually won you.',
    );
  }
  if (draft.systemUsed.length > FIELD_CAP) reasons.push(`The system is over ${FIELD_CAP} characters.`);
  if (draft.victory.length > FIELD_CAP) reasons.push(`The victory is over ${FIELD_CAP} characters.`);

  // The attack question is always answered. Silence would be indistinguishable from "no attack",
  // and those are different facts — mirror of `debriefs.attacked` being NOT NULL.
  if (draft.attacked === null) {
    reasons.push('Say whether the Bottom G attacked today.');
    return reasons;
  }

  if (draft.attacked) {
    if (draft.occurredAtHour === null) reasons.push('Say what hour the attack landed.');
    if (draft.outcome === null) reasons.push('Say how it went.');
    if (draft.propaganda.length > FIELD_CAP) {
      reasons.push(`The propaganda is over ${FIELD_CAP} characters.`);
    }
  }

  return reasons;
}

export function isComplete(draft: DebriefDraft): boolean {
  return blockers(draft).length === 0;
}

export interface DebriefPayload {
  sitrepId: string;
  attacked: boolean;
  systemUsed: string | null;
  victory: string | null;
  insightProtocolId: string | null;
  outcome: AttackOutcome | null;
  occurredAtHour: number | null;
  triggerKind: TriggerKind | null;
  propaganda: string | null;
  attackedProtocolId: string | null;
}

/** Trimmed to null, because an empty string is not a shorter answer — it is no answer. */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The write, shaped for `public.file_debrief`.
 *
 * Null for an incomplete debrief, so a half-answered one cannot be filed — the same rule
 * `toPayload` applies to the SITREP, and for the same reason.
 */
export function toPayload(
  sitrepId: string,
  draft: DebriefDraft,
  triggerKind: TriggerKind | null,
): DebriefPayload | null {
  if (!isComplete(draft) || draft.attacked === null) return null;
  if (draft.attacked && triggerKind === null) return null;

  return {
    sitrepId,
    attacked: draft.attacked,
    systemUsed: orNull(draft.systemUsed),
    victory: orNull(draft.victory),
    insightProtocolId: draft.insightProtocolId,
    // Everything about the attack is cleared when there was none. Mirror: file_debrief deletes
    // the tactic row, and `debriefs_outcome_iff_attacked` rejects an outcome without an attack.
    outcome: draft.attacked ? draft.outcome : null,
    occurredAtHour: draft.attacked ? draft.occurredAtHour : null,
    triggerKind: draft.attacked ? triggerKind : null,
    propaganda: draft.attacked ? orNull(draft.propaganda) : null,
    attackedProtocolId: draft.attacked ? draft.attackedProtocolId : null,
  };
}

/** The outbox coalescing key. One slot per day, matching `debriefs.sitrep_id` being unique. */
export function debriefKey(sitrepId: string): string {
  return `debrief:${sitrepId}`;
}

/**
 * What his own record says about the enemy.
 *
 * The reason the debrief is worth filling in twice. A man who has logged nine attacks can be told
 * when they land and what wins — which is the sentence DOCTRINE §6.3 promises and a group chat
 * can never produce.
 */
export interface AttackRecord {
  occurredAtHour: number;
  triggerKind: TriggerKind;
  outcome: AttackOutcome;
}

export interface AttackPattern {
  total: number;
  /** Counts per hour, index 0–23. */
  byHour: number[];
  /** The peak window, as a pair of hours, or null when there is no clear peak. */
  peakWindow: { from: number; to: number; share: number } | null;
  /** Triggers ordered by how often they beat him, worst first. */
  byTrigger: { kind: TriggerKind; attacks: number; losses: number }[];
}

/**
 * The minimum number of logged attacks before a pattern is claimed.
 *
 * Below this, "your enemy attacks at 15:00" is one incident dressed up as intelligence, and a man
 * who acts on it and finds nothing stops believing the next one. Five is the point at which a
 * three-hour window holding a majority is worth saying out loud.
 */
export const PATTERN_MINIMUM = 5;

export function attackPattern(records: readonly AttackRecord[]): AttackPattern {
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const record of records) {
    const hour = byHour[record.occurredAtHour];
    if (hour !== undefined) byHour[record.occurredAtHour] = hour + 1;
  }

  const triggers = new Map<TriggerKind, { attacks: number; losses: number }>();
  for (const record of records) {
    const entry = triggers.get(record.triggerKind) ?? { attacks: 0, losses: 0 };
    entry.attacks += 1;
    // `partial` counts as a loss here. He gave ground, and a metric that only counts total defeats
    // flatters him at exactly the point he needs the truth.
    if (record.outcome !== 'resisted') entry.losses += 1;
    triggers.set(record.triggerKind, entry);
  }

  const byTrigger = [...triggers.entries()]
    .map(([kind, counts]) => ({ kind, ...counts }))
    .sort((a, b) => b.losses - a.losses || b.attacks - a.attacks);

  return {
    total: records.length,
    byHour,
    peakWindow: records.length >= PATTERN_MINIMUM ? peakWindowOf(byHour, records.length) : null,
    byTrigger,
  };
}

/** The three-hour window holding the most attacks, reported only when it holds a real majority. */
function peakWindowOf(byHour: readonly number[], total: number): AttackPattern['peakWindow'] {
  let best = { from: 0, count: -1 };
  for (let from = 0; from < 24; from += 1) {
    const count =
      (byHour[from] ?? 0) + (byHour[(from + 1) % 24] ?? 0) + (byHour[(from + 2) % 24] ?? 0);
    if (count > best.count) best = { from, count };
  }
  // A window that holds less than half the attacks is not a pattern, it is where the numbers
  // happened to fall. Saying it anyway is how a man learns to ignore this screen.
  if (best.count * 2 <= total) return null;
  return { from: best.from, to: (best.from + 2) % 24, share: best.count / total };
}

/** `15` → `15:00`. Monospaced in the UI so a column of them compares. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
