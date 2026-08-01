import { useId, useState } from 'react';
import {
  TRANSFER_MINIMUM,
  answered,
  canAdopt,
  catalogue,
  verdict,
  type Application,
  type Playbook,
  type Transfer,
  type Verdict,
} from '@/features/playbooks/transfer';
import { Button } from '@/ui/Button';

/**
 * The catalogue, with no data access in it.
 *
 * This is the screen most at risk of becoming a feed, so the design is mostly a list of things
 * that are absent: no vote control, no comment box, no author byline, no adoption ranking, no
 * badge for a popular system. Each absence is asserted in tests/browser/playbooks.spec.ts,
 * because "we chose not to" is not a mechanism.
 *
 * What is present is the one number a circle can produce that a man cannot: how many tried it
 * and how many it held for. Including — deliberately, prominently — when the answer is that it
 * did not travel.
 */

export interface PlaybookListProps {
  playbooks: readonly Playbook[];
  order: readonly string[];
  mine: readonly Application[];
  transfer: ReadonlyMap<string, Transfer>;
  busy: boolean;
  refusal: string | null;
  onAdopt: (playbookId: string) => void;
  onAnswer: (applicationId: string, outcome: 'held' | 'did_not') => void;
  onAbandon: (applicationId: string) => void;
}

export function PlaybookList({
  playbooks,
  order,
  mine,
  transfer,
  busy,
  refusal,
  onAdopt,
  onAnswer,
  onAbandon,
}: PlaybookListProps) {
  const ordered = catalogue(playbooks, order);

  if (ordered.length === 0) {
    return (
      <Panel>
        <h2 className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase">
          Playbooks
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          Nothing here yet. A playbook is a system one man used that worked, written down so the
          rest can try it. The mentor promotes them from filed insights.
        </p>
      </Panel>
    );
  }

  return (
    <section
      aria-labelledby="playbooks-heading"
      data-testid="playbooks"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <header>
        <h2
          id="playbooks-heading"
          className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
        >
          Playbooks
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          Systems that worked for one man. Adopt one, run it, then say whether it worked for you.
          A system that did not travel is worth as much as one that did.
        </p>
      </header>

      {refusal ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {refusal}
        </p>
      ) : null}

      <ul className="mt-5 flex flex-col gap-5">
        {ordered.map((p) => (
          <PlaybookRow
            key={p.id}
            playbook={p}
            transfer={transfer.get(p.id)}
            application={mine.find((a) => a.playbookId === p.id)}
            adoptable={canAdopt(p, mine)}
            busy={busy}
            onAdopt={onAdopt}
            onAnswer={onAnswer}
            onAbandon={onAbandon}
          />
        ))}
      </ul>
    </section>
  );
}

function PlaybookRow({
  playbook,
  transfer,
  application,
  adoptable,
  busy,
  onAdopt,
  onAnswer,
  onAbandon,
}: {
  playbook: Playbook;
  transfer: Transfer | undefined;
  application: Application | undefined;
  adoptable: boolean;
  busy: boolean;
  onAdopt: (playbookId: string) => void;
  onAnswer: (applicationId: string, outcome: 'held' | 'did_not') => void;
  onAbandon: (applicationId: string) => void;
}) {
  const counts = transfer ?? {
    playbookId: playbook.id,
    adopted: 0,
    held: 0,
    didNot: 0,
    pending: 0,
  };
  const said = verdict(counts);

  return (
    <li
      data-testid="playbook"
      className={`border-t border-border-subtle pt-4 first:border-t-0 first:pt-0 ${
        playbook.isActive ? '' : 'opacity-60'
      }`}
    >
      <h3 className="text-sm font-semibold text-text-primary">
        {playbook.title}
        {!playbook.isActive ? (
          <span className="ml-2 text-xs font-normal text-text-muted">retired</span>
        ) : null}
      </h3>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-text-secondary">{playbook.body}</p>

      <p data-testid="verdict" className="mt-2 text-xs text-text-muted">
        {VERDICT[said](counts)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {application?.outcome === 'pending' ? (
          <>
            <span className="mr-1 text-xs text-text-secondary">Did it work for you?</span>
            <Button variant="secondary" onClick={() => onAnswer(application.id, 'held')} disabled={busy}>
              It held
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAnswer(application.id, 'did_not')}
              disabled={busy}
            >
              It did not
            </Button>
            {/* Abandoning is only legal while unanswered — see playbook-write.ts. */}
            <Button variant="quiet" onClick={() => onAbandon(application.id)} disabled={busy}>
              Abandon
            </Button>
          </>
        ) : application ? (
          <span
            data-testid="my-answer"
            className={`text-xs font-semibold uppercase ${
              application.outcome === 'held' ? 'text-status-pass' : 'text-status-fail'
            }`}
          >
            {application.outcome === 'held' ? 'It held for you' : 'It did not work for you'}
          </span>
        ) : adoptable ? (
          <Button onClick={() => onAdopt(playbook.id)} disabled={busy}>
            Adopt it
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * What the counts say, in a sentence.
 *
 * `personal` is written to take the blame off the man and put it on the system, which is the
 * entire reason this feature is worth building. §1 rules out AI-generated encouragement; this is
 * not encouragement, it is the accurate reading of the number.
 */
const VERDICT: Record<Verdict, (t: Transfer) => React.ReactNode> = {
  untested: (t) => (
    <>
      <span data-numeral>{answered(t)}</span> of{' '}
      <span data-numeral>{t.adopted}</span> who tried it have answered. At{' '}
      <span data-numeral>{TRANSFER_MINIMUM}</span> this will say whether it travels.
    </>
  ),
  travels: (t) => (
    <>
      Held for <span data-numeral className="text-status-pass">{t.held}</span> of{' '}
      <span data-numeral>{answered(t)}</span> who answered.
    </>
  ),
  personal: (t) => (
    <>
      Did not work for{' '}
      <span data-numeral className="text-status-fail">{t.didNot}</span> of{' '}
      <span data-numeral>{answered(t)}</span> who answered. This one looks personal to the man it
      came from rather than general — if it did not work for you, that is the system, not you.
    </>
  ),
  mixed: (t) => (
    <>
      Split: <span data-numeral>{t.held}</span> held, <span data-numeral>{t.didNot}</span> did
      not. Worth trying, and worth stopping if it is not yours.
    </>
  ),
};

/**
 * Promoting an insight into a playbook. Mentor only.
 *
 * Kept in this file rather than its own so the two halves of the feature stay side by side —
 * the thing the mentor writes and the thing the circle reads are the same object, and splitting
 * them is how the two drift apart.
 */
export function PromoteForm({
  busy,
  refusal,
  onPromote,
}: {
  busy: boolean;
  refusal: string | null;
  onPromote: (title: string, body: string) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const ready = title.trim() !== '' && body.trim() !== '' && !busy;

  return (
    <section
      aria-labelledby="promote-heading"
      data-testid="promote"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="promote-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Promote a system
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
        Take a system that worked for one man and offer it to the rest. Once promoted the words
        cannot be changed — men will be working from them.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <Labelled id={titleId} label="What to call it">
          <input
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clothes out the night before"
            className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-base text-text-primary placeholder:text-text-muted"
          />
        </Labelled>
        <Labelled id={bodyId} label="The system itself">
          <input
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Lay the kit out before bed so the morning has no decision in it"
            className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-base text-text-primary placeholder:text-text-muted"
          />
        </Labelled>
      </div>

      {refusal ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {refusal}
        </p>
      ) : null}

      <Button
        className="mt-4"
        onClick={() => {
          onPromote(title, body);
          setTitle('');
          setBody('');
        }}
        disabled={!ready}
      >
        Promote it
      </Button>
    </section>
  );
}

function Labelled({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6">
      {children}
    </section>
  );
}
