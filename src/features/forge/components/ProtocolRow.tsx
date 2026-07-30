import { useState } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { ProtocolStatus } from '@/features/forge/doctrine';
import {
  medReferences,
  offersMed,
  type DraftEntry,
  type ProtocolWithMed,
} from '@/features/forge/sitrep-draft';

/**
 * One protocol's answer.
 *
 * Two design rules govern this component, and the second was learned from a screenshot of the
 * first version.
 *
 * **The MED alternatives are positions in the same control as the pass and the fail.** Not a
 * sub-choice revealed after choosing "MED". Physical Forging would otherwise cost two taps every
 * day it is live, and — more importantly — the man is choosing between "I did the whole thing",
 * "I did this specific reduced version", and "I did not do it". Those are peer options, and a
 * control that presents them as peers tells the truth about the decision. The MED is the mechanic
 * that stops him writing the day off, not a fallback hidden behind a disclosure.
 *
 * **One border per row — in fact, none.** The first version nested a card inside a card inside a
 * box inside a box: page, protocol, MED, artefact, four rules of similar weight on four surfaces
 * of similar value. At 390px that made eleven protocols 3,900 pixels tall and gave the eye nothing
 * to lock onto. Depth is now carried by *type and colour* instead: a coloured rule for the MED,
 * muted small caps for metadata, and the only filled element on the row is the answer he chose.
 * If a change here adds a border, it is probably the wrong change.
 */

/** The answer as one value, so a protocol with two MEDs is still a single choice. */
type Choice = 'pass' | 'fail' | `med:${string}`;

function choiceOf(entry: DraftEntry | undefined): Choice | undefined {
  if (!entry?.status) return undefined;
  if (entry.status === 'med_pass') return entry.medOptionId ? `med:${entry.medOptionId}` : undefined;
  return entry.status;
}

export interface ProtocolRowProps {
  protocol: ProtocolWithMed;
  entry: DraftEntry | undefined;
  /** The member's own artefacts, substituted into MED text that names them. */
  artefacts: {
    topGCode: string | null;
    commandPostNote: string | null;
    fortressProtocol: string | null;
  };
  /**
   * Open the artefacts without a tap.
   *
   * Set for the first unanswered protocol only. The Morning Protocol MED says "read the Top G Code
   * aloud", and at 6am that instruction without the Code is friction at exactly the moment the MED
   * exists to rescue — so the row he is about to answer shows it, and the ten below it do not,
   * because ten expanded artefact blocks is the wall of text this replaced.
   */
  revealArtefacts?: boolean;
  onStatus: (protocol: ProtocolWithMed, status: ProtocolStatus) => void;
  onMedOption: (protocol: ProtocolWithMed, optionId: string) => void;
}

interface Option {
  value: Choice;
  label: string;
  /** Spoken name. The visible label is short because four of them share 360px. */
  accessibleName: string;
  tone: 'pass' | 'med' | 'fail';
}

function optionsFor(protocol: ProtocolWithMed): Option[] {
  const isDuty = protocol.kind === 'duty';
  const held: Option = {
    value: 'pass',
    label: isDuty ? 'Done' : 'Held',
    accessibleName: isDuty ? `${protocol.label}: done in full` : `${protocol.label}: held`,
    tone: 'pass',
  };
  const broken: Option = {
    value: 'fail',
    label: isDuty ? 'Missed' : 'Broke it',
    accessibleName: isDuty ? `${protocol.label}: missed` : `${protocol.label}: broke it`,
    tone: 'fail',
  };

  const med: Option[] = protocol.medOptions.map((option) => ({
    value: `med:${option.id}` as Choice,
    // A single MED needs no name — there is nothing to distinguish it from. Two do, and the
    // seeded labels ("Option A") are what the mentor wrote, so "A" and "B" are what he sees.
    label: protocol.medOptions.length === 1 ? 'MED' : option.label.replace(/^Option /, ''),
    accessibleName:
      protocol.medOptions.length === 1
        ? `${protocol.label}: minimum effective dose`
        : `${protocol.label}: minimum effective dose, ${option.label} — ${option.body}`,
    tone: 'med',
  }));

  return [held, ...med, broken];
}

const TONE_ON: Record<Option['tone'], string> = {
  pass: 'border-status-pass bg-status-pass text-accent-ink',
  med: 'border-status-med bg-status-med text-accent-ink',
  fail: 'border-status-fail bg-status-fail text-accent-ink',
};

const TONE_OFF: Record<Option['tone'], string> = {
  pass: 'border-border-strong text-text-secondary hover:border-status-pass hover:text-status-pass',
  med: 'border-border-strong text-text-secondary hover:border-status-med hover:text-status-med',
  fail: 'border-border-strong text-text-secondary hover:border-status-fail hover:text-status-fail',
};

export function ProtocolRow({
  protocol,
  entry,
  artefacts,
  revealArtefacts = false,
  onStatus,
  onMedOption,
}: ProtocolRowProps) {
  const options = optionsFor(protocol);
  const current = choiceOf(entry);
  const answered = current !== undefined;
  const headingId = `protocol-${protocol.slug}-label`;

  function onValueChange(value: string) {
    if (value === 'pass' || value === 'fail') {
      onStatus(protocol, value);
      return;
    }
    onMedOption(protocol, value.slice('med:'.length));
  }

  return (
    <li
      data-protocol={protocol.slug}
      data-answered={answered ? 'yes' : 'no'}
      // No card and no border. Rows are separated by the list's hairline dividers, so eleven of
      // them read as one list rather than eleven competing objects. An answered row recedes
      // rather than restyling, which keeps the rhythm intact as the list fills in.
      className={`px-4 py-3.5 transition-opacity sm:px-5 ${answered ? 'opacity-55' : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold text-text-primary">
          {protocol.label}
        </h3>
        {protocol.nickname ? (
          <span className="text-xs text-text-muted">{protocol.nickname}</span>
        ) : null}
        {protocol.visibility === 'aggregate_only' ? (
          // The §3.5 disclosure, compressed to a tag carrying the full sentence as its title.
          // Repeated verbatim on two rows it was two lines of boilerplate the eye learned to
          // skip, which is the opposite of what a disclosure is for.
          <span
            title="The circle sees this only in your day's status, never itemised. The mentor sees it."
            className="rounded-[var(--radius-sm)] border border-border-subtle px-1.5 py-0.5 text-[10px] tracking-wide text-text-muted uppercase"
          >
            Status only
          </span>
        ) : null}
      </div>

      {/* Shown while the row is unanswered, and kept once he has taken a MED so he can see which
          one he committed to. Hidden on a full pass or a miss, when it is prose between him and
          the next protocol. */}
      {offersMed(protocol) && (!answered || current?.startsWith('med:')) ? (
        <Med protocol={protocol} artefacts={artefacts} revealed={revealArtefacts} />
      ) : null}

      <RadioGroup.Root
        // Capped on wider screens. flex-1 across a 700px column gives three 220px buttons for a
        // one-word answer, which reads as a form that does not know what it is for; on a phone
        // they still fill the width, where the thumb needs them to.
        className="mt-3 flex gap-1.5 sm:max-w-md"
        value={current ?? ''}
        onValueChange={onValueChange}
        aria-labelledby={headingId}
        // Horizontal so the arrow keys match the layout. Radix handles the roving tabindex, so the
        // whole row is one tab stop and eleven protocols are eleven stops rather than thirty-eight.
        orientation="horizontal"
        loop={false}
      >
        {options.map((option) => {
          const on = current === option.value;
          return (
            <RadioGroup.Item
              key={option.value}
              value={option.value}
              aria-label={option.accessibleName}
              className={`min-h-11 flex-1 rounded-[var(--radius-sm)] border px-1 text-xs font-semibold tracking-wide transition-colors ${
                on ? TONE_ON[option.tone] : TONE_OFF[option.tone]
              }`}
            >
              {option.label}
            </RadioGroup.Item>
          );
        })}
      </RadioGroup.Root>
    </li>
  );
}

/**
 * The minimum effective dose, as one dense block rather than a boxed announcement.
 *
 * A coloured left rule carries "this is the MED" in the place a full-width uppercase banner used
 * to — which was louder than the controls beneath it, on a screen where the controls are the job.
 */
function Med({
  protocol,
  artefacts,
  revealed,
}: {
  protocol: ProtocolWithMed;
  artefacts: ProtocolRowProps['artefacts'];
  revealed: boolean;
}) {
  const single = protocol.medOptions.length === 1;
  const needed = neededArtefacts(protocol, artefacts);

  // Controlled, not `defaultOpen`. An uncontrolled Collapsible reads its default once at mount,
  // so the reveal would sit on whichever row happened to be first when the screen loaded and
  // never move — which is not "the row he is about to answer", it is "the first row". Null means
  // "follow the reveal"; once he opens or closes it himself his choice wins, because a panel that
  // shuts itself because he answered a different protocol is a panel fighting him.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? revealed;

  return (
    <div className="mt-2 border-l-2 border-status-med pl-3">
      <p className="text-xs leading-relaxed text-text-secondary">
        <span className="font-semibold tracking-wide text-status-med">MED </span>
        {single
          ? protocol.medOptions[0]?.body
          : protocol.medOptions.map((option, index) => (
              <span key={option.id}>
                {index > 0 ? <span className="text-text-muted"> · or · </span> : null}
                <span className="font-semibold text-text-primary">
                  {option.label.replace(/^Option /, '')}.{' '}
                </span>
                {option.body}
              </span>
            ))}
      </p>

      {needed.length > 0 ? (
        <Collapsible.Root open={open} onOpenChange={setChosen} className="mt-1">
          <Collapsible.Trigger
            data-testid={`artefacts-toggle-${protocol.slug}`}
            className="min-h-11 text-xs font-semibold text-text-muted underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            {needed.map((item) => item.term).join(' · ')}
          </Collapsible.Trigger>
          <Collapsible.Content>
            <dl className="mb-1 flex flex-col gap-1.5">
              {needed.map((item) => (
                <div key={item.term}>
                  <dt className="sr-only">{item.term}</dt>
                  <dd className="text-xs leading-relaxed text-text-primary">
                    {/* Said plainly when it is missing rather than left blank: a silent gap looks
                        like a rendering fault, and he cannot fix what nobody told him about. */}
                    {item.detail ?? (
                      <span className="text-text-muted">Not written yet — set it in Profile.</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Collapsible.Content>
        </Collapsible.Root>
      ) : null}
    </div>
  );
}

/**
 * Which of the member's own artefacts this protocol's MED refers to.
 *
 * The Morning Protocol says "read the Top G Code aloud"; Deep Work names the Fortress Protocol.
 * Printing the instruction without the thing is friction at the wrong moment, so the row offers
 * it — one tap away, and already open on the row he is about to answer.
 */
function neededArtefacts(
  protocol: ProtocolWithMed,
  artefacts: ProtocolRowProps['artefacts'],
): { term: string; detail: string | null }[] {
  const body = protocol.medOptions.map((option) => option.body).join(' ');
  const needs = medReferences(body);
  const shown: { term: string; detail: string | null }[] = [];
  if (needs.topGCode) shown.push({ term: 'Your Top G Code', detail: artefacts.topGCode });
  if (needs.commandPost) shown.push({ term: 'Your Command Post', detail: artefacts.commandPostNote });
  if (needs.fortressProtocol) {
    shown.push({ term: 'Your Fortress Protocol', detail: artefacts.fortressProtocol });
  }
  return shown;
}
