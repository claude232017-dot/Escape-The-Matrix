/**
 * The systems that worked, read back.
 *
 * This closes a hole rather than adding a feature. Until now the debrief asked a man to name his
 * victories and then showed them to nobody — not the circle, not the mentor, not even him. Only
 * the Bottom G's attacks got a readback, which makes the Intel tab a screen about losing, and
 * DOCTRINE §1 is explicit that externalising failure only works if the wins are equally visible.
 *
 * It also feeds Phase 7: playbooks are built by aggregating these, and nobody writes a good
 * insight they never expect to re-read.
 *
 * Circle-readable by ADR-013, so this can widen to the circle's insights in Phase 6 without a
 * policy change. It shows his own for now — the circle's is a different screen with a different
 * question ("what is working for anyone?") and deserves to be built as one.
 */

export interface Insight {
  sitrepId: string;
  localDate: string;
  systemUsed: string;
  victory: string;
  /** Which protocol it defended, resolved to a label. Null when he did not tie it to one. */
  protocolLabel: string | null;
}

export function InsightList({ insights }: { insights: readonly Insight[] }) {
  return (
    <section
      aria-labelledby="insights-heading"
      data-testid="insights"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="insights-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        What has worked
      </h2>

      {insights.length === 0 ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-text-secondary">
          Nothing recorded yet. Name a system in a debrief — the cause, not the feeling — and it
          lands here. These are what the playbooks get built from.
        </p>
      ) : (
        <ol data-testid="insight-list" className="mt-3 divide-y divide-border-subtle">
          {insights.map((insight) => (
            <li key={insight.sitrepId} className="py-3">
              {/* The system first and in the accent, because the system is the reusable part. The
                  victory is evidence that it worked; on its own it is a feeling. */}
              <p className="text-sm leading-relaxed text-status-pass">{insight.systemUsed}</p>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{insight.victory}</p>
              <p className="mt-1 text-xs text-text-muted">
                <span data-numeral>{insight.localDate}</span>
                {insight.protocolLabel ? ` · defended ${insight.protocolLabel}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
