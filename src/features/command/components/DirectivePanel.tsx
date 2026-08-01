import { useId, useState } from 'react';
import { DIRECTIVE_CAP } from '@/features/command/directive-write';
import type { Directive } from '@/features/command/use-command-data';
import type { Standing } from '@/features/command/correlation';
import { Button } from '@/ui/Button';

/**
 * The mentor's instruction, and the man's copy of it.
 *
 * One panel serving both sides, because they are the same fact seen from two ends — and putting
 * the subject's view somewhere else would mean two components that must agree about what a
 * directive is.
 *
 * What is deliberately missing: any way to reply. §1 rules out chat, and the difference between
 * a directive and a message is exactly that absence. If he wants to answer, he answers in his
 * weekly review or he says it to the mentor's face.
 *
 * Presentational — no data access, so it can be driven in a browser with no credentials.
 */

export interface DirectivePanelProps {
  directives: readonly Directive[];
  standings: readonly Standing[];
  profileId: string;
  weekStart: string;
  isMentor: boolean;
  refusal: string | null;
  busy: boolean;
  onSend: (subjectId: string, body: string) => void;
  onWithdraw: (id: string) => void;
}

export function DirectivePanel({
  directives,
  standings,
  profileId,
  weekStart,
  isMentor,
  refusal,
  busy,
  onSend,
  onWithdraw,
}: DirectivePanelProps) {
  const mine = directives.filter((d) => d.subjectId === profileId && d.weekStart === weekStart);
  const written = directives.filter((d) => d.authorId === profileId && d.weekStart === weekStart);

  // Nothing to show and nothing to write: the panel is absent rather than empty.
  if (!isMentor && mine.length === 0) return null;

  return (
    <section
      aria-labelledby="directive-heading"
      data-testid="directives"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="directive-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Directives
      </h2>

      {mine.map((d) => (
        <div
          key={d.id}
          data-testid="my-directive"
          className="mt-3 border-l-2 border-status-med bg-surface-base px-3 py-2"
        >
          <p className="text-sm text-text-primary">{d.body}</p>
          <p className="mt-1 text-xs text-text-muted">
            From your mentor, for the week of <span data-numeral>{weekStart}</span>. There is
            nothing to reply to — answer it in the work.
          </p>
        </div>
      ))}

      {isMentor ? (
        <Compose
          standings={standings}
          written={written}
          profileId={profileId}
          refusal={refusal}
          busy={busy}
          onSend={onSend}
          onWithdraw={onWithdraw}
        />
      ) : null}
    </section>
  );
}

function Compose({
  standings,
  written,
  profileId,
  refusal,
  busy,
  onSend,
  onWithdraw,
}: {
  standings: readonly Standing[];
  written: readonly Directive[];
  profileId: string;
  refusal: string | null;
  busy: boolean;
  onSend: (subjectId: string, body: string) => void;
  onWithdraw: (id: string) => void;
}) {
  const selectId = useId();
  const bodyId = useId();
  // Everyone but himself. The database refuses a self-directive too — this just never offers it.
  const others = standings.filter((s) => s.profileId !== profileId);
  const [subjectId, setSubjectId] = useState(others[0]?.profileId ?? '');
  const [body, setBody] = useState('');

  const alreadyWritten = written.find((d) => d.subjectId === subjectId);
  const tooLong = body.trim().length > DIRECTIVE_CAP;
  const ready = body.trim() !== '' && !tooLong && !busy && !alreadyWritten;

  return (
    <div className="mt-5 border-t border-border-subtle pt-4">
      {written.length > 0 ? (
        <ul data-testid="written-directives" className="mb-4 flex flex-col gap-2">
          {written.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-text-secondary">
                <span className="text-text-primary">
                  {standings.find((s) => s.profileId === d.subjectId)?.displayName ?? '—'}
                </span>
                {' · '}
                {d.body}
              </span>
              {/* Withdraw, not edit. There is no edit — see directive-write.ts. */}
              <Button variant="quiet" onClick={() => onWithdraw(d.id)} disabled={busy}>
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={selectId}
            className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
          >
            To
          </label>
          <select
            id={selectId}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-base text-text-primary"
          >
            {others.map((s) => (
              <option key={s.profileId} value={s.profileId}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={bodyId}
            className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
          >
            The instruction
          </label>
          <input
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ten offers before Friday. No exceptions."
            maxLength={DIRECTIVE_CAP * 2}
            aria-invalid={tooLong ? true : undefined}
            className={`min-h-11 rounded-[var(--radius-md)] border bg-surface-base px-3 text-base text-text-primary placeholder:text-text-muted ${
              tooLong ? 'border-status-fail' : 'border-border-strong'
            }`}
          />
        </div>
      </div>

      {refusal ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {refusal}
        </p>
      ) : null}

      {alreadyWritten ? (
        <p data-testid="already-written" className="mt-3 text-xs text-text-muted">
          You have already written to him this week. Withdraw it to say something else — one
          instruction a week is the point.
        </p>
      ) : null}

      <Button
        className="mt-4"
        onClick={() => {
          onSend(subjectId, body);
          setBody('');
        }}
        disabled={!ready}
      >
        Send it
      </Button>
    </div>
  );
}
