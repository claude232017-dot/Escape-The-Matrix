import { useId } from 'react';
import {
  BODY_CAP,
  MAX_COMMITMENTS,
  blockers,
  canWithdraw,
  tally,
  weekPhase,
  type Commitment,
  type WeekPhase,
  type WeekView,
} from '@/features/week/commitment-draft';
import type { CircleCommitment } from '@/features/week/use-week-data';
import { Button } from '@/ui/Button';

/**
 * The week, with no data access in it.
 *
 * Presentational for the same reason SitrepForm and LedgerForm are: it can be driven in a real
 * browser with no credentials, which is where the interaction claims get tested rather than
 * asserted.
 *
 * The screen shows **one thing at a time**, decided by `weekPhase`. Mid-week there is nothing to
 * press — the commitments are declared, the week is running, and the honest answer is a list and
 * silence. A screen that invents an interaction there is inventing busywork, and busywork is
 * what makes a man stop opening an app.
 *
 * There is no edit control anywhere on this screen, and its absence is the feature. A commitment
 * is immutable from the moment it is written (0008_commitments.sql). The only way back is a
 * same-day withdrawal, which is a typo escape hatch rather than a way out.
 */

export type WeekState = 'idle' | 'working' | 'sent' | 'held' | 'refused' | 'lost';

export interface WeekFormProps {
  current: WeekView;
  previous: WeekView;
  circle: readonly CircleCommitment[];
  profileId: string;
  today: string;
  /** The slate he is composing. Only meaningful in the 'declare' phase. */
  drafts: string[];
  state: WeekState;
  statusMessage: string;
  refusal: string | null;
  onDraft: (index: number, value: string) => void;
  onDeclare: () => void;
  onWithdraw: (id: string) => void;
  onSettle: (id: string, outcome: 'hit' | 'missed') => void;
}

export function WeekForm({
  current,
  previous,
  circle,
  profileId,
  today,
  drafts,
  state,
  statusMessage,
  refusal,
  onDraft,
  onDeclare,
  onWithdraw,
  onSettle,
}: WeekFormProps) {
  const phase = weekPhase(current, today);
  // Last week is what he settles. Its phase is computed independently, because a man can be
  // mid-week on this one and still owe answers on that one.
  const lastPhase = weekPhase(previous, today);

  return (
    <div className="flex flex-col gap-6">
      {lastPhase === 'settle' ? (
        <SettlePanel week={previous} onSettle={onSettle} />
      ) : null}

      <section
        aria-labelledby="week-heading"
        data-testid="week"
        className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
      >
        <header>
          <h2
            id="week-heading"
            className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
          >
            This week
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
            {COPY[phase]}
          </p>
        </header>

        {phase === 'declare' ? (
          <Declare
            drafts={drafts}
            existing={current.commitments}
            state={state}
            statusMessage={statusMessage}
            refusal={refusal}
            today={today}
            onDraft={onDraft}
            onDeclare={onDeclare}
            onWithdraw={onWithdraw}
          />
        ) : (
          <DeclaredList
            commitments={current.commitments}
            today={today}
            onWithdraw={onWithdraw}
            showOutcome={phase === 'settle' || phase === 'settled'}
          />
        )}
      </section>

      <CirclePanel circle={circle} profileId={profileId} />
    </div>
  );
}

/**
 * One sentence per phase, and none of them congratulate him.
 *
 * §1 rules out AI-generated encouragement, and the same instinct applies to hand-written
 * encouragement: "Great work!" after a hit week is the app having an opinion about a man's life
 * on the strength of three checkboxes. These state what is true and stop.
 */
const COPY: Record<WeekPhase, string> = {
  declare:
    'Up to three. Declaring is committing — once written, a commitment cannot be reworded, ' +
    'and you answer for it on Sunday.',
  live: 'Declared. Nothing to do here until Sunday.',
  settle: 'The week is over. Answer each one.',
  settled: 'Answered.',
  'missed-the-week': 'No commitments were declared for this week.',
};

function Declare({
  drafts,
  existing,
  state,
  statusMessage,
  refusal,
  today,
  onDraft,
  onDeclare,
  onWithdraw,
}: {
  drafts: string[];
  existing: readonly Commitment[];
  state: WeekState;
  statusMessage: string;
  refusal: string | null;
  today: string;
  onDraft: (index: number, value: string) => void;
  onDeclare: () => void;
  onWithdraw: (id: string) => void;
}) {
  const remaining = blockers(drafts);
  const ready = remaining.length === 0 && state !== 'working';

  return (
    <>
      {existing.length > 0 ? (
        <DeclaredList
          commitments={existing}
          today={today}
          onWithdraw={onWithdraw}
          showOutcome={false}
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {drafts.map((value, index) => (
          <CommitmentInput
            // The index *is* the identity here: these are three positional slots being typed
            // into, not a list being reordered, so nothing can shift underneath a focused input.
            key={index}
            index={index}
            value={value}
            onChange={(next) => onDraft(index, next)}
          />
        ))}
      </div>

      {refusal ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {refusal}
        </p>
      ) : null}

      {remaining.length > 0 ? (
        <ul data-testid="week-blockers" className="mt-3 flex flex-col gap-1">
          {remaining.map((reason) => (
            <li key={reason} className="text-xs text-text-muted">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={onDeclare} disabled={!ready}>
          {state === 'working' ? 'Declaring…' : 'Declare the week'}
        </Button>
        <p data-testid="week-status" aria-live="polite" className="text-xs text-text-muted">
          {statusMessage}
        </p>
      </div>
    </>
  );
}

function CommitmentInput({
  index,
  value,
  onChange,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  const over = value.trim().length > BODY_CAP;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
      >
        Commitment <span data-numeral>{index + 1}</span>
        {index > 0 ? <span className="ml-2 normal-case tracking-normal text-text-muted">optional</span> : null}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // A specific claim, not a mood. The placeholder is doing doctrine work: it is the
        // difference between "train more" and something a man can answer yes or no to.
        placeholder={index === 0 ? 'Ten sales calls before Friday' : ''}
        maxLength={BODY_CAP * 2}
        aria-invalid={over ? true : undefined}
        className={`min-h-11 rounded-[var(--radius-md)] border bg-surface-base px-3 text-base text-text-primary placeholder:text-text-muted ${
          over ? 'border-status-fail' : 'border-border-strong'
        }`}
      />
    </div>
  );
}

function DeclaredList({
  commitments,
  today,
  onWithdraw,
  showOutcome,
}: {
  commitments: readonly Commitment[];
  today: string;
  onWithdraw: (id: string) => void;
  showOutcome: boolean;
}) {
  if (commitments.length === 0) return null;

  return (
    <ul data-testid="week-declared" className="mt-4 flex flex-col gap-2">
      {commitments.map((c) => (
        <li
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-2 first:border-t-0 first:pt-0"
        >
          <span className="text-sm text-text-primary">{c.body}</span>
          <span className="flex items-center gap-3">
            {showOutcome && c.outcome !== 'pending' ? (
              <span
                className={`text-xs font-semibold uppercase ${
                  c.outcome === 'hit' ? 'text-status-pass' : 'text-status-fail'
                }`}
              >
                {c.outcome}
              </span>
            ) : null}
            {canWithdraw(c, today) ? (
              // Same-day only. Not an edit — there is no edit — and it disappears tomorrow.
              <Button variant="quiet" onClick={() => onWithdraw(c.id)}>
                Withdraw
              </Button>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SettlePanel({
  week,
  onSettle,
}: {
  week: WeekView;
  onSettle: (id: string, outcome: 'hit' | 'missed') => void;
}) {
  const counts = tally(week.commitments);

  return (
    <section
      aria-labelledby="settle-heading"
      data-testid="settle"
      className="rounded-[var(--radius-lg)] border-l-2 border-status-med bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="settle-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Last week is unanswered
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
        <span data-numeral>{counts.pending}</span> of <span data-numeral>{counts.total}</span> still
        to answer. Hit or missed — there is no third answer, and nobody else can give it.
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {week.commitments
          .filter((c) => c.outcome === 'pending')
          .map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-text-primary">{c.body}</span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => onSettle(c.id, 'hit')}>
                  Hit
                </Button>
                <Button variant="secondary" onClick={() => onSettle(c.id, 'missed')}>
                  Missed
                </Button>
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

/**
 * What the circle declared.
 *
 * Exactly what the enrollment disclosure says the other men see: the commitments and whether
 * they were hit. Not a leaderboard — no ordering by count, no totals per man, nothing that
 * ranks. §1 rules out the social feed, and a table sorted by hits is a feed with a different
 * shape. Grouped by name, in the order the server returned them.
 */
function CirclePanel({
  circle,
  profileId,
}: {
  circle: readonly CircleCommitment[];
  profileId: string;
}) {
  const others = circle.filter((c) => c.profileId !== profileId);
  if (others.length === 0) return null;

  const byMember = new Map<string, CircleCommitment[]>();
  for (const c of others) {
    byMember.set(c.displayName, [...(byMember.get(c.displayName) ?? []), c]);
  }

  return (
    <section
      aria-labelledby="circle-week-heading"
      data-testid="circle-week"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="circle-week-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        What the circle declared
      </h2>
      <div className="mt-4 flex flex-col gap-4">
        {[...byMember.entries()].map(([name, items]) => (
          <div key={name}>
            <h3 className="text-sm font-semibold text-text-primary">{name}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {items.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-text-secondary">{c.body}</span>
                  {c.outcome !== 'pending' ? (
                    <span
                      className={`text-xs font-semibold uppercase ${
                        c.outcome === 'hit' ? 'text-status-pass' : 'text-status-fail'
                      }`}
                    >
                      {c.outcome}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-text-muted">
        Everyone declares up to <span data-numeral>{MAX_COMMITMENTS}</span>. This is not a
        ranking and there is no total.
      </p>
    </section>
  );
}
