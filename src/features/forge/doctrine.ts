import { addDays, campaignDay, daysBetween, type IsoDate } from '@/lib/date';

/**
 * The circle's rules, as functions.
 *
 * Everything the Forge decides about a day is decided here, in pure code with no database and
 * no React, because these rules are the product. A bug in the SITREP screen is an
 * inconvenience; a bug in "was that a tactical failure or an act of treason" tells a man he
 * lost twenty-seven days that he did not lose.
 *
 * The source of truth is docs/DOCTRINE.md, versioned alongside `campaigns.ruleset_version`.
 * When this file and that document disagree, the document wins and this file is wrong.
 */

/** A protocol's result for one day. `med_pass` is a **pass**, stored distinctly. */
export type ProtocolStatus = 'pass' | 'med_pass' | 'fail';

/** What the day amounted to. Mirrors `sitreps.final_status`. */
export type DayOutcome =
  /** Every active protocol held. The campaign advances. */
  | 'complete'
  /** Tactical failure: the day is lost and repeated. The campaign continues. */
  | 'repeat'
  /** Act of treason. The day count returns to Day 1 via a **new enrollment**. */
  | 'reset';

/** Why a reset happened. Recorded so patterns in resets become visible too. */
export type ResetKind = 'treason' | 'zero_day';

export interface ProtocolForDay {
  slug: string;
  /** First campaign day on which this protocol is live. */
  activatesOnDay: number;
  /** Failing this is an act of treason on its own — the sexual-discipline oath. */
  isTreasonTrigger: boolean;
}

export interface ProtocolResult {
  slug: string;
  status: ProtocolStatus;
}

/**
 * Rules that may be tuned between campaigns. Stored per campaign as `ruleset_version`, so a
 * past campaign is always readable under the rules it was actually run under.
 */
export interface Ruleset {
  /**
   * How many failed **active** protocols make a zero day.
   *
   * Three, per the current doctrine. Counted against *active* protocols only — see
   * docs/DOCTRINE.md §10, open question 4. This matters most in week one: if only three
   * protocols are live, three failures is everything, and treating "all of them" as a zero day
   * is arguably right but is the owner's call, not this file's.
   */
  zeroDayThreshold: number;
}

export const DEFAULT_RULESET: Ruleset = { zeroDayThreshold: 3 };

/** Protocols live on `day`. A protocol not yet active cannot be failed and must not be offered. */
export function activeProtocols<T extends ProtocolForDay>(protocols: readonly T[], day: number): T[] {
  return protocols.filter((protocol) => day >= protocol.activatesOnDay);
}

export type DayEvaluation =
  /**
   * Not every active protocol was reported, so the day cannot be judged.
   *
   * Deliberately not treated as a set of passes. An unreported protocol is *unknown*, and
   * silently reading it as held would let a man complete a campaign by leaving the hard ones
   * blank — corrupting the dataset the whole product exists to build.
   */
  | { kind: 'incomplete'; missing: string[] }
  | {
      kind: 'evaluated';
      outcome: DayOutcome;
      /** Slugs that failed, in the order the protocols were given. */
      failed: string[];
      /** Slugs passed at MED. A win, recorded separately so analysis can see it. */
      medPassed: string[];
      /** Set when `outcome` is 'reset'. */
      resetKind: ResetKind | null;
      /** Results submitted for protocols that were not yet active. Ignored, but reported. */
      ignoredInactive: string[];
    };

/**
 * Judge one day.
 *
 * The order of the checks is the doctrine:
 *
 *  1. A MED pass is a **pass**. It does not break continuity, does not repeat the day, and does
 *     not count toward a zero day. "The only true failure is zero."
 *  2. Failing a treason-trigger protocol is an act of treason on its own, regardless of how few
 *     other things failed.
 *  3. Three or more failed active protocols is a zero day, which is also an act of treason.
 *  4. One or two failures is a tactical failure: the day is lost and repeated, the campaign
 *     continues.
 *  5. No failures is a complete day.
 */
export function evaluateDay(input: {
  day: number;
  protocols: readonly ProtocolForDay[];
  results: readonly ProtocolResult[];
  ruleset?: Ruleset;
}): DayEvaluation {
  const ruleset = input.ruleset ?? DEFAULT_RULESET;
  const active = activeProtocols(input.protocols, input.day);
  const activeSlugs = new Set(active.map((protocol) => protocol.slug));

  const byslug = new Map<string, ProtocolStatus>();
  const ignoredInactive: string[] = [];
  for (const result of input.results) {
    if (activeSlugs.has(result.slug)) {
      byslug.set(result.slug, result.status);
    } else {
      // A result for a protocol that is not live yet. Not an error — a client may be a day
      // behind, or the mentor may have moved an activation day — but it carries no weight.
      ignoredInactive.push(result.slug);
    }
  }

  const missing = active.filter((protocol) => !byslug.has(protocol.slug)).map((p) => p.slug);
  if (missing.length > 0) return { kind: 'incomplete', missing };

  const failed = active.filter((protocol) => byslug.get(protocol.slug) === 'fail');
  const medPassed = active
    .filter((protocol) => byslug.get(protocol.slug) === 'med_pass')
    .map((protocol) => protocol.slug);

  const treason = failed.some((protocol) => protocol.isTreasonTrigger);
  const zeroDay = failed.length >= ruleset.zeroDayThreshold;

  let outcome: DayOutcome;
  let resetKind: ResetKind | null = null;
  if (treason || zeroDay) {
    outcome = 'reset';
    // Treason named in preference to zero_day when both apply: the oath is the specific thing
    // that happened, and "zero day" would describe it less truthfully.
    resetKind = treason ? 'treason' : 'zero_day';
  } else if (failed.length > 0) {
    outcome = 'repeat';
  } else {
    outcome = 'complete';
  }

  return {
    kind: 'evaluated',
    outcome,
    failed: failed.map((protocol) => protocol.slug),
    medPassed,
    resetKind,
    ignoredInactive,
  };
}

/**
 * One enrollment in a campaign. A reset creates a **new row** pointing at the previous one, so
 * the chain is intact and no history is ever destroyed. See ADR-002.
 */
export interface Enrollment {
  id: string;
  startedOn: IsoDate;
  previousEnrollmentId: string | null;
}

/**
 * Which day of the campaign `date` is, for this enrollment. 1-based: `startedOn` is Day 1.
 *
 * Derived, never stored. There is no counter to decrement, which is what makes "a reset destroys
 * nothing" true rather than aspirational.
 */
export function dayNumber(enrollment: Enrollment, date: IsoDate): number {
  return campaignDay(enrollment.startedOn, date);
}

/**
 * The enrollment a reset produces.
 *
 * Starts the day **after** the treason, not the same day: the day of the breach is over and it
 * is recorded against the enrollment it happened in. Starting the new one on the same date would
 * make one calendar date belong to two enrollments, and every aggregate over "day 1" would then
 * double-count it.
 */
export function enrollmentAfterReset(
  current: Enrollment,
  resetOn: IsoDate,
  newId: string,
): Enrollment {
  return {
    id: newId,
    startedOn: addDays(resetOn, 1),
    previousEnrollmentId: current.id,
  };
}

/**
 * How far through a fixed-length campaign this enrollment has got.
 *
 * Clamped at both ends so a caller rendering a progress bar cannot produce something impossible
 * from a date outside the campaign.
 */
export function campaignProgress(
  enrollment: Enrollment,
  today: IsoDate,
  lengthDays: number,
): { day: number; lengthDays: number; complete: boolean } {
  const raw = dayNumber(enrollment, today);
  const day = Math.min(raw, lengthDays);
  return { day, lengthDays, complete: raw > lengthDays };
}

/**
 * Consecutive days held, counting back from `upTo`.
 *
 * A **MED pass counts**, which is the entire point of the mechanic: it is what makes the streak
 * honest rather than something a man lies to protect. A day that is absent from the record breaks
 * the streak — silence is not a pass, for the same reason an unreported protocol is not.
 */
export function currentStreak(
  outcomes: ReadonlyMap<IsoDate, DayOutcome>,
  upTo: IsoDate,
  startedOn: IsoDate,
): number {
  let streak = 0;
  for (let offset = 0; ; offset += 1) {
    const date = addDays(upTo, -offset);
    if (daysBetween(startedOn, date) < 0) break;
    if (outcomes.get(date) !== 'complete') break;
    streak += 1;
  }
  return streak;
}

/**
 * Whether a day still needs a SITREP.
 *
 * Every date from the enrollment's start up to and including today that has no record. Used to
 * show a man what he has left blank rather than letting missed days quietly accumulate — a day
 * with no SITREP is still a day of the campaign, and silence does not pause the clock.
 */
export function unreportedDays(
  reported: ReadonlySet<IsoDate>,
  enrollment: Enrollment,
  today: IsoDate,
): IsoDate[] {
  const span = daysBetween(enrollment.startedOn, today);
  if (span < 0) return [];
  const missing: IsoDate[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addDays(enrollment.startedOn, offset);
    if (!reported.has(date)) missing.push(date);
  }
  return missing;
}
