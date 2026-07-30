import { activeProtocols, type DayEvaluation, type ProtocolStatus } from '@/features/forge/doctrine';
import { unanswered, type ProtocolWithMed, type SitrepDraft } from '@/features/forge/sitrep-draft';
import { ProtocolRow } from '@/features/forge/components/ProtocolRow';
import { Button } from '@/ui/Button';

/**
 * The SITREP screen, with no data access in it.
 *
 * Every input is a prop and every action is a callback, so the screen can be driven in a real
 * browser with no Supabase credentials — which is how the sixty-second gate is *measured* rather
 * than asserted. See tests/browser/sitrep.spec.ts.
 *
 * Two things this deliberately does not do:
 *
 *  - It does not congratulate him. §1 forbids AI-generated encouragement, and a screen that says
 *    "great work!" for a complete day is the same mechanism by hand. What it says is what happened.
 *  - It does not soften a reset. A reset is reported as a fact with its consequence stated, in the
 *    same register as a complete day. Framed as a verdict it becomes something to avoid filing,
 *    and an unfiled reset is a hole in the only dataset this product exists to build.
 */

export type FileState = 'idle' | 'working' | 'sent' | 'held' | 'refused' | 'lost';

export interface SitrepFormProps {
  day: number;
  localDate: string;
  campaignLengthDays: number;
  protocols: readonly ProtocolWithMed[];
  draft: SitrepDraft;
  evaluation: DayEvaluation;
  artefacts: {
    topGCode: string | null;
    commandPostNote: string | null;
    fortressProtocol: string | null;
  };
  /** True once a SITREP already exists on the server for this day. */
  alreadyFiled: boolean;
  fileState: FileState;
  /** The honest queue wording. Never "saved" for something still on the device. */
  queueMessage: string;
  /** Set when the write was refused outright. */
  refusal: string | null;
  onStatus: (protocol: ProtocolWithMed, status: ProtocolStatus) => void;
  onMedOption: (protocol: ProtocolWithMed, optionId: string) => void;
  onFile: () => void;
}

export function SitrepForm({
  day,
  localDate,
  campaignLengthDays,
  protocols,
  draft,
  evaluation,
  artefacts,
  alreadyFiled,
  fileState,
  queueMessage,
  refusal,
  onStatus,
  onMedOption,
  onFile,
}: SitrepFormProps) {
  const active = activeProtocols(protocols, day);
  const remaining = unanswered(draft, protocols, day);
  const complete = remaining.length === 0;

  return (
    <section
      aria-labelledby="sitrep-heading"
      data-testid="sitrep"
      data-day={day}
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="sitrep-heading" className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase">
          Today&apos;s SITREP
        </h2>
        <p className="text-xs text-text-muted">
          <span data-numeral>{localDate}</span>
        </p>
      </header>

      <p className="mt-2 text-2xl">
        <span data-numeral className="text-accent">
          Day {day}
        </span>{' '}
        <span data-numeral className="text-text-muted">
          / {campaignLengthDays}
        </span>
      </p>

      {alreadyFiled ? (
        <p className="mt-2 text-xs text-text-muted">
          Already filed today. Answering again replaces it.
        </p>
      ) : null}

      <ol className="mt-5 flex flex-col gap-3">
        {active.map((protocol) => (
          <ProtocolRow
            key={protocol.slug}
            protocol={protocol}
            entry={draft[protocol.slug]}
            artefacts={artefacts}
            onStatus={onStatus}
            onMedOption={onMedOption}
          />
        ))}
      </ol>

      <Verdict evaluation={evaluation} remaining={remaining.length} localDate={localDate} />

      <div className="mt-5 flex flex-col gap-3">
        <Button
          onClick={onFile}
          disabled={!complete || fileState === 'working'}
          data-testid="file-sitrep"
          className="w-full"
        >
          {fileState === 'working' ? 'Filing…' : alreadyFiled ? 'Refile the day' : 'File the day'}
        </Button>

        {/* The honest report, from @/features/forge/use-outbox describeQueue(). "Held on this
            device" is true and useful; a tick would be a lie, and a man who believes his SITREP
            is filed does not file it again. */}
        <p
          data-testid="queue-status"
          role="status"
          className={`text-xs leading-relaxed ${
            fileState === 'sent'
              ? 'text-status-pass'
              : fileState === 'refused' || fileState === 'lost'
                ? 'text-status-fail'
                : 'text-text-muted'
          }`}
        >
          {queueMessage}
        </p>

        {refusal ? (
          <p role="alert" className="text-xs leading-relaxed text-status-fail">
            {refusal}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * What the day currently amounts to.
 *
 * Shown live, before he files, because the point of the MED is that a man can see the day is
 * recoverable while he still has the day. Discovering after the fact that two misses cost him
 * nothing is information that arrives too late to be used.
 */
function Verdict({
  evaluation,
  remaining,
  localDate,
}: {
  evaluation: DayEvaluation;
  remaining: number;
  localDate: string;
}) {
  if (evaluation.kind === 'incomplete') {
    return (
      <p
        data-testid="verdict"
        data-outcome="incomplete"
        aria-live="polite"
        className="mt-4 text-sm text-text-secondary"
      >
        <span data-numeral>{remaining}</span>{' '}
        {remaining === 1 ? 'protocol still needs an answer.' : 'protocols still need an answer.'}
      </p>
    );
  }

  const { outcome, failed, medPassed, resetKind } = evaluation;

  return (
    <div
      data-testid="verdict"
      data-outcome={outcome}
      aria-live="polite"
      className="mt-4 rounded-[var(--radius-md)] border border-border-subtle bg-surface-sunken p-4"
    >
      {outcome === 'complete' ? (
        <>
          <p className="text-sm font-semibold text-status-pass">This is a complete day.</p>
          {medPassed.length > 0 ? (
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {/* Stated as the win it is. A MED pass keeps the streak, and calling it anything
                  less is what makes a man stop using it. */}
              <span data-numeral>{medPassed.length}</span>{' '}
              {medPassed.length === 1 ? 'protocol was held' : 'protocols were held'} at the minimum
              effective dose. That counts.
            </p>
          ) : null}
        </>
      ) : null}

      {outcome === 'repeat' ? (
        <>
          <p className="text-sm font-semibold text-status-fail">
            Tactical failure. <span data-numeral>{failed.length}</span>{' '}
            {failed.length === 1 ? 'protocol' : 'protocols'} missed.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            The day is lost and repeats. The campaign continues and nothing before today changes.
          </p>
        </>
      ) : null}

      {outcome === 'reset' ? (
        <>
          <p className="text-sm font-semibold text-status-treason">
            {resetKind === 'treason' ? 'An act of treason under the oath.' : 'A zero day.'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            The count returns to Day 1 tomorrow. Every day up to and including{' '}
            <span data-numeral>{localDate}</span> stays in the record — the reset opens a new
            enrollment rather than erasing this one.
          </p>
        </>
      ) : null}

      {failed.length > 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          {/* Named, not counted. "Two protocols failed" is not something he can act on;
              "junk-food, video-games" is. */}
          Missed: {failed.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
