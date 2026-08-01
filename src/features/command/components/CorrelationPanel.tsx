import { formatMoney, fromRow } from '@/lib/money';
import {
  COMPARISON_MINIMUM,
  allActions,
  comparison,
  deepWork,
  finding,
  weeks,
  type Comparison,
  type Finding,
  type MemberDay,
} from '@/features/command/correlation';

/**
 * Where the two loops meet, for one man.
 *
 * This is the screen the whole product was built toward, and the discipline that makes it worth
 * anything is **what it refuses to say**. For most of a thirty-day campaign the honest answer is
 * "not enough days yet", and that is rendered as a plain statement rather than an empty state or
 * a spinner — it is the correct answer, not a missing one.
 *
 * Revenue appears here as a weekly column and is never fed to the comparison. Four weeks is not
 * a correlation, and one invoice landing on a Tuesday moves a week by a factor no man's
 * discipline explains. See correlation.ts for the full argument.
 */

export function CorrelationPanel({ days }: { days: readonly MemberDay[] }) {
  if (days.length === 0) return null;

  const work = comparison(days, deepWork);
  const actions = comparison(days, allActions);
  const rollups = weeks(days);

  return (
    <section
      aria-labelledby="correlation-heading"
      data-testid="correlation"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="correlation-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Discipline against output
      </h2>

      <Claim label="Deep work blocks" comparison={work} unit="blocks" />
      <Claim label="All business actions" comparison={actions} unit="actions" />

      <WeekTable rollups={rollups} />
    </section>
  );
}

/**
 * One comparison, stated in a sentence.
 *
 * The sentence for each finding is fixed, and none of them praise him. §1 rules out AI-generated
 * encouragement and the same instinct applies to written encouragement: the app's job is to put
 * the number in front of him, not to have a view about his character.
 */
function Claim({
  label,
  comparison: c,
  unit,
}: {
  label: string;
  comparison: Comparison;
  unit: string;
}) {
  const verdict = finding(c);

  return (
    <div data-testid={`claim-${unit}`} className="mt-5 border-t border-border-subtle pt-4 first:border-t-0">
      <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-text-secondary">
        {SENTENCE[verdict]({ c, unit })}
      </p>
      {verdict !== 'not-enough' ? (
        <p className="mt-2 text-xs text-text-muted">
          Averaged over <span data-numeral>{c.heldCount}</span> days you held and{' '}
          <span data-numeral>{c.brokenCount}</span> you did not. Repeat days are in neither.
        </p>
      ) : null}
    </div>
  );
}

const SENTENCE: Record<Finding, (input: { c: Comparison; unit: string }) => React.ReactNode> = {
  'not-enough': ({ c }) => (
    <>
      Not enough yet. This needs <span data-numeral>{COMPARISON_MINIMUM}</span> days on each side
      before it says anything; you have <span data-numeral>{c.heldCount}</span> held and{' '}
      <span data-numeral>{c.brokenCount}</span> broken. It will not guess in the meantime.
    </>
  ),
  'higher-when-held': ({ c, unit }) => (
    <>
      <span data-numeral className="text-status-pass">
        {c.onHeldDays.toFixed(1)}
      </span>{' '}
      {unit} on the days you held the line, against{' '}
      <span data-numeral className="text-status-fail">
        {c.onBrokenDays.toFixed(1)}
      </span>{' '}
      on the days you did not.
    </>
  ),
  'higher-when-broken': ({ c, unit }) => (
    <>
      <span data-numeral className="text-status-fail">
        {c.onBrokenDays.toFixed(1)}
      </span>{' '}
      {unit} on the days your discipline broke, against{' '}
      <span data-numeral>{c.onHeldDays.toFixed(1)}</span> on the days it held. That is the
      opposite of what this system assumes, and it is worth working out why before acting on it.
    </>
  ),
  'no-difference': ({ c, unit }) => (
    <>
      No difference worth naming: <span data-numeral>{c.onHeldDays.toFixed(1)}</span> {unit} on
      held days against <span data-numeral>{c.onBrokenDays.toFixed(1)}</span> on broken ones.
    </>
  ),
};

/**
 * Format a week's revenue, or null when this build cannot read it.
 *
 * `fromRow` validates the currency against `CURRENCY_EXPONENTS` and throws on one it does not
 * know. That is the right behaviour for a write and the wrong behaviour for a summary table: a
 * currency added to the database ahead of the client would otherwise blank the entire Intel tab
 * rather than one cell. Reported as "—", the same as a week with no revenue at all.
 */
function money(amountMinor: string, currency: string | null): string | null {
  if (currency === null) return null;
  try {
    return formatMoney(fromRow(amountMinor, currency));
  } catch {
    return null;
  }
}

/**
 * The weekly columns, reported and not correlated.
 *
 * A table rather than a chart on purpose. Four rows of three numbers is a table; drawing it as a
 * line implies a trend, and a trend through four points is the thing this feature refuses to
 * claim in every other place.
 */
function WeekTable({ rollups }: { rollups: ReturnType<typeof weeks> }) {
  if (rollups.length === 0) return null;

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-xs">
        <caption className="sr-only">
          Each week of the campaign: days held, deep work blocks, and revenue booked
        </caption>
        <thead>
          <tr className="text-text-muted">
            <th scope="col" className="pb-1 font-semibold">Week of</th>
            <th scope="col" className="pb-1 text-right font-semibold">Held</th>
            <th scope="col" className="pb-1 text-right font-semibold">Blocks</th>
            <th scope="col" className="pb-1 text-right font-semibold">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rollups.map((w) => (
            <tr key={w.weekStart} className="border-t border-border-subtle">
              <td data-numeral className="py-1.5 text-text-secondary">{w.weekStart}</td>
              <td data-numeral className="py-1.5 text-right text-text-secondary">
                {w.daysHeld}/{w.daysReported}
              </td>
              <td data-numeral className="py-1.5 text-right text-text-secondary">
                {w.deepWorkBlocks}
              </td>
              <td data-numeral className="py-1.5 text-right text-text-secondary">
                {w.mixedCurrency ? (
                  // Adding dollars to pounds produces a number that is wrong in a way that
                  // looks right, so the week says so instead of showing one.
                  <span className="text-text-muted">mixed</span>
                ) : (
                  (money(w.revenueMinor, w.currency) ?? '—')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
