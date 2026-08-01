import { addDays, compareDates, startOfWeek, type IsoDate } from '@/lib/date';

/**
 * The correlation engine.
 *
 * ---------------------------------------------------------------------------
 * What this is allowed to claim, and what it is not
 * ---------------------------------------------------------------------------
 * ARCHITECTURE says the correlation between discipline and money is the one thing nothing off
 * the shelf provides. That is true, and it is also the sentence most likely to produce a
 * confident number from nothing. So the arithmetic here is deliberately smaller than the
 * ambition, and the reasons are worth stating rather than discovering:
 *
 * **Revenue is reported, never correlated.** A thirty-day campaign is four weeks. A correlation
 * coefficient over four points is noise with a decimal place on it, and revenue is lumpy — one
 * invoice landing on a Tuesday moves a week by a factor nobody's discipline explains. There is
 * no `r` in this file for a reason.
 *
 * **Discipline against effort is a real question at thirty points.** *On the days he held the
 * line, did he do more of the work that makes money?* That is a comparison between two groups of
 * days, not a regression, and ADR-003 already named the metric: deep work blocks, "the bridge
 * between the Forge and the Ledger". Thirty days is enough to see a difference; it is not enough
 * to see a small one, so the minimum below is a floor on both groups.
 *
 * **It refuses rather than hedges.** The same discipline as AttackPatternPanel, which will not
 * name an attack window under five incidents. A man who acts on a finding, discovers it was
 * three days of noise, and learns the app makes things up will never trust the real finding when
 * it arrives — and the real finding is the entire product.
 */

/**
 * Days required in **each** group before a comparison is offered.
 *
 * Five held days against five broken ones. Not a statistical threshold — no honest one exists at
 * this sample size — but a floor below which the difference is obviously a coincidence, and the
 * number a man can check by hand if he doubts it.
 */
export const COMPARISON_MINIMUM = 5;

/** One reported day, both loops on it. Mirrors `public.member_days` in 0009_command.sql. */
export interface MemberDay {
  profileId: string;
  localDate: IsoDate;
  finalStatus: 'complete' | 'repeat' | 'reset';
  deepWorkBlocks: number;
  businessActions: number;
  /** Minor units, as a string. Never a JS number — §3.2 and src/lib/money.ts. */
  revenueMinor: string;
  currency: string | null;
  currencyCount: number;
}

/**
 * A day counts as *held* when its status is `complete`.
 *
 * `repeat` is deliberately not held: the day was survivable but the line moved, and folding it
 * in with the clean days would blur exactly the distinction the comparison is testing. It is not
 * counted as broken either — see `comparison`, which drops repeats rather than guessing.
 */
export function held(day: MemberDay): boolean {
  return day.finalStatus === 'complete';
}

export interface Comparison {
  /** Mean over the held days. */
  onHeldDays: number;
  /** Mean over the days that broke. */
  onBrokenDays: number;
  heldCount: number;
  brokenCount: number;
  /** True when both groups cleared `COMPARISON_MINIMUM`. Nothing is claimed when false. */
  enough: boolean;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compare one metric across held and broken days.
 *
 * Repeat days are **excluded from both groups** rather than assigned to one. A repeat is its own
 * thing — the day was survived at a cost — and putting it on either side would move the answer
 * by a decision nobody made on purpose.
 */
export function comparison(days: readonly MemberDay[], metric: (d: MemberDay) => number): Comparison {
  const heldDays = days.filter(held);
  const brokenDays = days.filter((d) => d.finalStatus === 'reset');

  return {
    onHeldDays: mean(heldDays.map(metric)),
    onBrokenDays: mean(brokenDays.map(metric)),
    heldCount: heldDays.length,
    brokenCount: brokenDays.length,
    enough: heldDays.length >= COMPARISON_MINIMUM && brokenDays.length >= COMPARISON_MINIMUM,
  };
}

/** The two metrics worth comparing. ADR-003: deep work is the bridge. */
export const deepWork = (d: MemberDay): number => d.deepWorkBlocks;
export const allActions = (d: MemberDay): number => d.businessActions;

/**
 * What the comparison is allowed to say out loud.
 *
 * A direction, not a magnitude, and only when there is enough on both sides. `'not-enough'` is
 * a first-class answer rather than an error state — for most of a campaign it is the *correct*
 * one, and a screen that treats it as a failure will be treating the truth as a failure for
 * three weeks out of four.
 */
export type Finding = 'higher-when-held' | 'higher-when-broken' | 'no-difference' | 'not-enough';

/**
 * A tenth of a block per day. Below this the two means are the same number wearing different
 * rounding, and calling it a finding would be the fake precision this file exists to avoid.
 */
const MEANINGFUL_GAP = 0.1;

export function finding(c: Comparison): Finding {
  if (!c.enough) return 'not-enough';
  const gap = c.onHeldDays - c.onBrokenDays;
  if (Math.abs(gap) < MEANINGFUL_GAP) return 'no-difference';
  return gap > 0 ? 'higher-when-held' : 'higher-when-broken';
}

/** A week's totals, for reporting. Revenue lives here and is never fed to `comparison`. */
export interface WeekRollup {
  weekStart: IsoDate;
  daysReported: number;
  daysHeld: number;
  daysReset: number;
  deepWorkBlocks: number;
  businessActions: number;
  /** Minor units as a string, summed only within a single currency. */
  revenueMinor: string;
  currency: string | null;
  /** True when the week mixed currencies, so the total above must not be shown. */
  mixedCurrency: boolean;
}

/**
 * Roll the daily grain up to weeks, newest first.
 *
 * The currency handling is the fiddly part and the part that matters: summing across currencies
 * produces a number that is wrong in a way that looks right. When a week contains more than one,
 * the total is suppressed and `mixedCurrency` says so, rather than adding dollars to pounds.
 */
export function weeks(days: readonly MemberDay[]): WeekRollup[] {
  const byWeek = new Map<IsoDate, MemberDay[]>();
  for (const day of days) {
    const key = startOfWeek(day.localDate);
    byWeek.set(key, [...(byWeek.get(key) ?? []), day]);
  }

  return [...byWeek.entries()]
    .map(([weekStart, group]): WeekRollup => {
      const currencies = new Set(
        group.map((d) => d.currency).filter((c): c is string => c !== null),
      );
      const mixed = currencies.size > 1;
      const revenue = group.reduce((sum, d) => sum + BigInt(d.revenueMinor), 0n);

      return {
        weekStart,
        daysReported: group.length,
        daysHeld: group.filter(held).length,
        daysReset: group.filter((d) => d.finalStatus === 'reset').length,
        deepWorkBlocks: group.reduce((sum, d) => sum + d.deepWorkBlocks, 0),
        businessActions: group.reduce((sum, d) => sum + d.businessActions, 0),
        revenueMinor: mixed ? '0' : revenue.toString(),
        currency: mixed ? null : ([...currencies][0] ?? null),
        mixedCurrency: mixed,
      };
    })
    .sort((a, b) => compareDates(b.weekStart, a.weekStart));
}

/**
 * One man's standing, for the Commander's View.
 *
 * Facts about where he is, not a score. There is no total, no ordering key and nothing that
 * ranks — §1 rules out the leaderboard, and a "commander's view" is precisely where one would
 * otherwise appear.
 */
export interface Standing {
  profileId: string;
  displayName: string;
  /** The most recent day he reported on, or null if he never has. */
  lastReported: IsoDate | null;
  /** Consecutive days up to and including yesterday with no report. */
  daysSilent: number;
  daysHeld: number;
  daysReset: number;
  commitmentsPending: number;
}

/**
 * How long since he last filed, counted in days up to `today`.
 *
 * Yesterday's silence is not drift — a day is not late until it is over — so a report filed
 * yesterday gives zero. Never having filed gives null rather than a large number, because
 * "has not started" and "has stopped" are different situations and a mentor should not have to
 * infer which one he is looking at.
 */
export function daysSilent(lastReported: IsoDate | null, today: IsoDate): number {
  if (lastReported === null) return 0;
  let silent = 0;
  let cursor = addDays(today, -1);
  while (compareDates(cursor, lastReported) > 0) {
    silent += 1;
    cursor = addDays(cursor, -1);
  }
  return silent;
}

/**
 * Who the mentor should look at, and why.
 *
 * Ordered by how long a man has been silent, longest first — which is an ordering by *need for
 * attention*, not by performance. The distinction matters: a list sorted by days held is a
 * league table, and this one puts the man doing worst at the top for the opposite reason.
 *
 * Men with nothing to flag are not returned at all. A commander's view that lists everyone every
 * day trains the reader to skim it.
 */
export function needsAttention(standings: readonly Standing[], threshold = 2): Standing[] {
  return standings
    .filter((s) => s.daysSilent >= threshold || s.commitmentsPending > 0 || s.daysReset > 0)
    .sort((a, b) => b.daysSilent - a.daysSilent || b.daysReset - a.daysReset);
}
