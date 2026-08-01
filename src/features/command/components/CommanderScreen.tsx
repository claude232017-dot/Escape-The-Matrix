import { needsAttention, type Standing } from '@/features/command/correlation';
import { CorrelationPanel } from '@/features/command/components/CorrelationPanel';
import type { CommandData } from '@/features/command/use-command-data';

/**
 * The Commander's View.
 *
 * The mentor's screen over the whole circle — and the place where this app would most naturally
 * grow a leaderboard, so the shape is a deliberate refusal of one.
 *
 * What it shows is **who needs attention and why**, ordered by how long a man has been silent.
 * That is an ordering by need, not by performance: the man doing worst is at the top, which is
 * the opposite of what a ranking does with him. There is no total, no percentage, no column that
 * can be sorted by output, and men with nothing to flag do not appear at all — a screen that
 * lists everyone every day trains the reader to skim it.
 *
 * `isMentor` here is presentation only. What actually stops a member reading another man's
 * revenue is the RLS policy under `member_days`, and the view is `security_invoker` so those
 * policies apply as the caller. A member who reached this component anyway would see the roster
 * and no money — asserted in tests/db/command-rls.test.ts rather than assumed.
 */

export interface CommanderScreenProps {
  data: CommandData;
  isMentor: boolean;
}

export function CommanderScreen({ data, isMentor }: CommanderScreenProps) {
  const { loaded, error } = data;

  if (error) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-status-fail">
          {error}
        </p>
      </Panel>
    );
  }

  if (!loaded) {
    return (
      <Panel>
        <p aria-busy="true" className="text-sm text-text-muted">
          Loading the circle…
        </p>
      </Panel>
    );
  }

  const flagged = needsAttention(loaded.standings);

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="attention-heading"
        data-testid="attention"
        className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
      >
        <h2
          id="attention-heading"
          className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
        >
          Needs attention
        </h2>

        {flagged.length === 0 ? (
          // Not a celebration. A statement that there is nothing here today, which is the
          // whole point of a list that is usually empty.
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
            Nobody is silent, nobody owes an answer, and nobody reset. Nothing to act on.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {flagged.map((s) => (
              <li
                key={s.profileId}
                className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0"
              >
                <span className="text-sm font-semibold text-text-primary">{s.displayName}</span>
                <span className="text-xs text-text-secondary">{reason(s)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="roster-heading"
        data-testid="roster"
        className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
      >
        <h2
          id="roster-heading"
          className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
        >
          The circle
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-xs">
            <caption className="sr-only">
              Every member, with the days he held, the days he reset, and when he last reported
            </caption>
            <thead>
              <tr className="text-text-muted">
                <th scope="col" className="pb-1 font-semibold">Member</th>
                <th scope="col" className="pb-1 text-right font-semibold">Held</th>
                <th scope="col" className="pb-1 text-right font-semibold">Reset</th>
                <th scope="col" className="pb-1 text-right font-semibold">Last report</th>
              </tr>
            </thead>
            <tbody>
              {/* Alphabetical, deliberately. Any other order is a ranking. */}
              {[...loaded.standings]
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((s) => (
                  <tr key={s.profileId} className="border-t border-border-subtle">
                    <td className="py-1.5 text-text-secondary">{s.displayName}</td>
                    <td data-numeral className="py-1.5 text-right text-text-secondary">
                      {s.daysHeld}
                    </td>
                    <td
                      data-numeral
                      className={`py-1.5 text-right ${s.daysReset > 0 ? 'text-status-fail' : 'text-text-secondary'}`}
                    >
                      {s.daysReset}
                    </td>
                    <td data-numeral className="py-1.5 text-right text-text-secondary">
                      {s.lastReported ?? 'never'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!isMentor ? (
          <p className="mt-4 text-xs text-text-muted">
            You are seeing what every member sees: whether a man filed and whether his day held.
            Protocol detail and revenue are not in this table.
          </p>
        ) : null}
      </section>

      {/* His own correlation, on the same screen. The mentor is a man in the campaign too. */}
      <CorrelationPanel days={loaded.mine} />
    </div>
  );
}

/**
 * Why a man is on the list, in the fewest words that are still specific.
 *
 * "Drifting" tells a mentor nothing he can open a conversation with. "Silent 4 days" does.
 */
function reason(s: Standing): string {
  const parts: string[] = [];
  if (s.daysSilent >= 2) parts.push(`silent ${String(s.daysSilent)} days`);
  if (s.commitmentsPending > 0) {
    parts.push(
      `${String(s.commitmentsPending)} commitment${s.commitmentsPending === 1 ? '' : 's'} unanswered`,
    );
  }
  if (s.daysReset > 0) parts.push(`${String(s.daysReset)} reset`);
  return parts.join(' · ');
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6">
      {children}
    </section>
  );
}
