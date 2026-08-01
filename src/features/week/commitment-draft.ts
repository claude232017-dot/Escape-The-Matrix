import { addDays, compareDates, dayOfWeek, startOfWeek, type IsoDate } from '@/lib/date';

/**
 * The weekly loop, as pure functions. DOCTRINE §8.
 *
 * No React and no network, for the same reason the Forge's doctrine module has neither: these
 * are the rules, and rules are worth testing without a browser or a database in the way.
 *
 * Every rule here is duplicated in SQL, and the SQL is the one that is true — §3.3. What this
 * buys is a fast, specific refusal before a round trip, and a screen that can grey out the
 * button rather than letting a man type for a minute and then be told no.
 */

/**
 * Three. DOCTRINE §8.
 *
 * Mirror: `app.enforce_commitment_ceiling()` in 0008_commitments.sql, which is what makes it
 * true. A cap rather than a target — the copy says so, because three slots on a screen read as
 * three boxes to fill.
 */
export const MAX_COMMITMENTS = 3;

/** Mirror: `public.capped_text_140`. ADR-001 — a commitment is a claim, not a paragraph. */
export const BODY_CAP = 140;

/** Mirror: `public.commitment_outcome` in 0008_commitments.sql. */
export const OUTCOMES = ['pending', 'hit', 'missed'] as const;
export type CommitmentOutcome = (typeof OUTCOMES)[number];

export interface Commitment {
  id: string;
  body: string;
  outcome: CommitmentOutcome;
  /** The day he declared it, in his own timezone. Monday is the ritual; this is the fact. */
  declaredOn: IsoDate;
}

/** The week a man is looking at, and what he may do to it. */
export interface WeekView {
  weekStart: IsoDate;
  commitments: Commitment[];
}

/**
 * Which of the two things this screen does is available right now.
 *
 * Deliberately one function returning one answer rather than three booleans scattered through a
 * component: "can he declare, can he settle, or neither" is a single question about where he is
 * in the week, and splitting it is how a screen ends up offering both at once.
 *
 * Mirror: the insert policy and `app.enforce_commitment_windows()` in 0008_commitments.sql.
 */
export type WeekPhase =
  /** Nothing declared yet and the week is live: the slate is open. */
  | 'declare'
  /** Declared, week still running. Nothing to do but the work. */
  | 'live'
  /** Sunday or later, with commitments still pending. */
  | 'settle'
  /** Everything answered. */
  | 'settled'
  /** A week that has come and gone with nothing declared. Not a prompt — a fact. */
  | 'missed-the-week';

export function weekPhase(view: WeekView, today: IsoDate): WeekPhase {
  const sunday = addDays(view.weekStart, 6);
  const weekIsOver = compareDates(today, sunday) >= 0;

  if (view.commitments.length === 0) {
    return weekIsOver ? 'missed-the-week' : 'declare';
  }
  if (!weekIsOver) return 'live';
  return view.commitments.every((c) => c.outcome !== 'pending') ? 'settled' : 'settle';
}

/**
 * Whether he may still add to this week's slate.
 *
 * Note what this does **not** say: nothing about editing. There is no edit. A commitment is
 * immutable from the moment it is written (0008), so the only question is whether the slate has
 * room and the week is still running.
 */
export function canDeclare(view: WeekView, today: IsoDate): boolean {
  if (view.commitments.length >= MAX_COMMITMENTS) return false;
  return compareDates(today, addDays(view.weekStart, 6)) < 0;
}

/**
 * Whether a row he declared today can still be taken back.
 *
 * Same-day only, and only while pending. It is a typo escape hatch, not a way out: by tomorrow
 * the commitment stands whatever he now thinks of it.
 *
 * Mirror: policy `commitments_delete_same_day`.
 */
export function canWithdraw(commitment: Commitment, today: IsoDate): boolean {
  return commitment.outcome === 'pending' && commitment.declaredOn === today;
}

/** Mirror: `app.enforce_commitment_windows()` — settling opens on Sunday and never closes. */
export function canSettle(view: WeekView, today: IsoDate): boolean {
  return compareDates(today, addDays(view.weekStart, 6)) >= 0;
}

/**
 * What is wrong with this slate, in the order a man would fix it.
 *
 * Returns an empty array when it is sendable. Written as reasons rather than a boolean because
 * "the button is disabled" with no explanation is the worst version of this screen.
 */
export function blockers(bodies: readonly string[]): string[] {
  const kept = bodies.map((b) => b.trim()).filter((b) => b !== '');
  const reasons: string[] = [];

  if (kept.length === 0) reasons.push('Write at least one commitment.');
  if (kept.length > MAX_COMMITMENTS) {
    reasons.push(`Three is the cap. You have written ${String(kept.length)}.`);
  }
  if (kept.some((b) => b.length > BODY_CAP)) {
    reasons.push(`Keep each one under ${String(BODY_CAP)} characters. Say the specific thing.`);
  }
  // Two identical commitments are one commitment and a wasted slot. Compared case-insensitively
  // because "Ten sales calls" and "ten sales calls" are the same promise.
  const seen = new Set(kept.map((b) => b.toLowerCase()));
  if (seen.size !== kept.length) reasons.push('Two of these are the same commitment.');

  return reasons;
}

/** The payload for `public.declare_commitments`, or null when the slate is not sendable. */
export interface DeclarePayload {
  weekStart: IsoDate;
  bodies: string[];
}

export function toPayload(weekStart: IsoDate, bodies: readonly string[]): DeclarePayload | null {
  if (blockers(bodies).length > 0) return null;
  return { weekStart, bodies: bodies.map((b) => b.trim()).filter((b) => b !== '') };
}

/** One outbox slot per member-week: a retried slate replaces, it does not stack. */
export function declareKey(weekStart: IsoDate): string {
  return `commitments:${weekStart}`;
}

/** One slot per commitment, so settling three does not coalesce into settling one. */
export function settleKey(commitmentId: string): string {
  return `settle:${commitmentId}`;
}

/**
 * How the week reads at a glance: two hit, one missed, none pending.
 *
 * A count, not a score. §1 rules out gamification, so there is no streak here, no percentage and
 * nothing that goes up — a man who hit two of three had a week, and the app's job is to say so
 * plainly and let him draw the conclusion.
 */
export interface WeekTally {
  hit: number;
  missed: number;
  pending: number;
  total: number;
}

export function tally(commitments: readonly Commitment[]): WeekTally {
  return {
    hit: commitments.filter((c) => c.outcome === 'hit').length,
    missed: commitments.filter((c) => c.outcome === 'missed').length,
    pending: commitments.filter((c) => c.outcome === 'pending').length,
    total: commitments.length,
  };
}

/**
 * The Monday of the week containing `today`, for this member.
 *
 * A thin wrapper over `startOfWeek` so that every caller in this feature goes through one place,
 * and so the mirror note has somewhere to live: `app.week_start_for()` in 0008_commitments.sql
 * must answer with the same Monday for the same member at the same instant. Both derive it from
 * an already-zone-resolved calendar date rather than from an instant — §3.1.
 */
export function weekStartFor(today: IsoDate): IsoDate {
  return startOfWeek(today);
}

/** True when `today` is the Monday — the day §8 asks him to declare. Used for prompting only. */
export function isDeclarationDay(today: IsoDate): boolean {
  return dayOfWeek(today) === 1;
}
