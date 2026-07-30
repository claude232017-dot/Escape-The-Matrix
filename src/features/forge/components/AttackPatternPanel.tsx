import {
  PATTERN_MINIMUM,
  TRIGGER_LABELS,
  attackPattern,
  formatHour,
  type AttackRecord,
} from '@/features/forge/debrief-draft';

/**
 * What his own record says about the enemy.
 *
 * This is the reason the debrief gets filled in a second time. Data entry into a void stops after
 * a week; a screen that answers back does not. DOCTRINE §6.3 promises sentences a chat channel
 * can never produce, and this is the first of them delivered.
 *
 * The discipline that matters here is **refusing to claim a pattern that is not there**. Below
 * `PATTERN_MINIMUM` attacks, or when they are scattered across the day, it says so plainly
 * instead of naming a window. A man who acts on "your enemy attacks at 15:00", finds nothing, and
 * learns the app makes things up will never trust the real finding when it arrives.
 *
 * This is his own data only. A peer cannot read `bottom_g_tactics` at all — see
 * 0005_debrief.sql and tests/db/debrief-rls.test.ts.
 */
export function AttackPatternPanel({ attacks }: { attacks: readonly AttackRecord[] }) {
  const pattern = attackPattern(attacks);

  if (pattern.total === 0) return null;

  const peak = Math.max(...pattern.byHour, 1);
  const worst = pattern.byTrigger[0];

  return (
    <section
      aria-labelledby="pattern-heading"
      data-testid="attack-pattern"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="pattern-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Your enemy&apos;s pattern
      </h2>

      <p data-testid="pattern-headline" className="mt-3 max-w-prose text-sm leading-relaxed text-text-secondary">
        {pattern.peakWindow ? (
          <>
            He attacks between{' '}
            <span data-numeral className="text-status-fail">
              {formatHour(pattern.peakWindow.from)}
            </span>{' '}
            and{' '}
            <span data-numeral className="text-status-fail">
              {formatHour(pattern.peakWindow.to)}
            </span>
            .{' '}
            <span data-numeral>{Math.round(pattern.peakWindow.share * 100)}%</span> of your{' '}
            <span data-numeral>{pattern.total}</span> recorded attacks land there.
          </>
        ) : pattern.total < PATTERN_MINIMUM ? (
          <>
            <span data-numeral>{pattern.total}</span>{' '}
            {pattern.total === 1 ? 'attack' : 'attacks'} logged. At{' '}
            <span data-numeral>{PATTERN_MINIMUM}</span> this will start telling you when he
            prefers to move.
          </>
        ) : (
          <>
            No clear window yet — your{' '}
            <span data-numeral>{pattern.total}</span> attacks are spread across the day. That is a
            finding too: he is not waiting for a particular hour.
          </>
        )}
      </p>

      <Histogram byHour={pattern.byHour} peak={peak} total={pattern.total} />

      {worst && pattern.total >= PATTERN_MINIMUM ? (
        <p data-testid="pattern-worst" className="mt-5 max-w-prose text-sm leading-relaxed text-text-secondary">
          <span className="text-status-fail">{TRIGGER_LABELS[worst.kind]}</span> is his most
          effective weapon against you — you lose to it{' '}
          <span data-numeral>{worst.losses}</span> times in{' '}
          <span data-numeral>{worst.attacks}</span>.
        </p>
      ) : null}

      {pattern.byTrigger.length > 0 ? (
        <table className="mt-4 w-full text-left text-xs">
          <caption className="sr-only">Attacks and losses by trigger</caption>
          <thead>
            <tr className="text-text-muted">
              <th scope="col" className="pb-1 font-semibold">
                Trigger
              </th>
              <th scope="col" className="pb-1 text-right font-semibold">
                Attacks
              </th>
              <th scope="col" className="pb-1 text-right font-semibold">
                Lost
              </th>
            </tr>
          </thead>
          <tbody>
            {pattern.byTrigger.map((row) => (
              <tr key={row.kind} className="border-t border-border-subtle">
                <td className="py-1.5 text-text-secondary">{TRIGGER_LABELS[row.kind]}</td>
                <td data-numeral className="py-1.5 text-right text-text-secondary">
                  {row.attacks}
                </td>
                <td
                  data-numeral
                  className={`py-1.5 text-right ${row.losses > 0 ? 'text-status-fail' : 'text-status-pass'}`}
                >
                  {row.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/**
 * Attacks by hour.
 *
 * Bars are CSS heights rather than a charting library, which keeps the bundle honest and means it
 * survives `prefers-reduced-motion` and a 320px screen without configuration. The numbers are also
 * in the accessible name of each column, because a bar chart that only exists visually is a chart
 * half the point of which is missing.
 */
function Histogram({ byHour, peak, total }: { byHour: number[]; peak: number; total: number }) {
  return (
    <div className="mt-4">
      <ol
        aria-label={`Attacks by hour of the day, ${total} in total`}
        className="flex h-16 items-end gap-px"
      >
        {byHour.map((count, hour) => (
          <li
            key={hour}
            aria-label={`${formatHour(hour)}: ${count} ${count === 1 ? 'attack' : 'attacks'}`}
            // `h-full` is load-bearing, not padding. The bar's height is a percentage, and a
            // percentage resolves against a parent with a *definite* height — without this the
            // list item is auto-height, every bar computes to zero, and the chart silently
            // renders as a flat line. Caught by the accessible-name test, which could not find
            // an element that had no box.
            className="flex h-full flex-1 items-end"
          >
            <div
              // A hairline for an empty hour rather than nothing at all, so the axis reads as a
              // day with gaps rather than as a chart that failed to render.
              style={{ height: count === 0 ? '2px' : `${Math.max(8, (count / peak) * 100)}%` }}
              className={`w-full ${count === 0 ? 'bg-border-subtle' : 'bg-status-fail'}`}
            />
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-xs text-text-muted">
        <span data-numeral>00:00</span>
        <span data-numeral>12:00</span>
        <span data-numeral>23:00</span>
      </div>
    </div>
  );
}
