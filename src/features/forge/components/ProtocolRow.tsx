import * as RadioGroup from '@radix-ui/react-radio-group';
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
 * The design decision that matters most here: **the MED alternatives are positions in the same
 * control as the pass and the fail.** Not a sub-choice revealed after choosing "MED".
 *
 * Two reasons. The budget — Physical Forging would otherwise cost two taps every day it is live,
 * and there are eleven protocols inside sixty seconds. And the doctrine — the man is choosing
 * between "I did the whole thing", "I did this specific reduced version", and "I did not do it".
 * Those are four peer options for a protocol with two MEDs, and a control that presents them as
 * four is telling the truth about the decision. The MED is not a fallback hidden behind a
 * disclosure; it is the mechanic that stops him writing the day off.
 *
 * The MED text sits above the control, visible while the row is unanswered, because the moment he
 * reads it is the moment he is deciding.
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
    // seeded labels ("Option A") are what the mentor wrote, so they are what he sees.
    label: protocol.medOptions.length === 1 ? 'MED' : option.label,
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

  // The row's border stays constant and only the fill changes. Making the border carry
  // answered-vs-unanswered would put information on a `decorative` token, which owes only 1.5:1 —
  // and the answer is already legible from the filled control, so the container is decoration on
  // top of a signal rather than the signal itself.
  return (
    <li
      data-protocol={protocol.slug}
      data-answered={answered ? 'yes' : 'no'}
      className={`rounded-[var(--radius-md)] border border-border-subtle p-4 ${
        answered ? 'bg-surface-base' : 'bg-surface-raised'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-text-primary">
          {protocol.label}
        </h3>
        <p className="text-xs text-text-muted">
          {protocol.kind === 'duty' ? 'duty' : 'prohibition'}
        </p>
      </div>

      {protocol.nickname ? (
        <p className="mt-0.5 text-xs text-text-muted">{protocol.nickname}</p>
      ) : null}

      {/* Shown while the row is unanswered, and kept once he has taken a MED so he can see which
          one he committed to. Hidden on a full pass or a miss, because at that point it is prose
          between him and the next protocol. */}
      {offersMed(protocol) && (!answered || current?.startsWith('med:')) ? (
        <Med protocol={protocol} artefacts={artefacts} />
      ) : null}

      {protocol.visibility === 'aggregate_only' ? (
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          The circle sees this only in your day&apos;s status — never itemised. The mentor sees it.
        </p>
      ) : null}

      <RadioGroup.Root
        className="mt-3 flex gap-2"
        value={current ?? ''}
        onValueChange={onValueChange}
        aria-labelledby={headingId}
        // Horizontal so the arrow keys match the layout. Radix handles the roving tabindex, so
        // the whole row is one tab stop and eleven protocols are eleven stops rather than
        // thirty-three.
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

function Med({
  protocol,
  artefacts,
}: {
  protocol: ProtocolWithMed;
  artefacts: ProtocolRowProps['artefacts'];
}) {
  const single = protocol.medOptions.length === 1;

  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-border-subtle bg-surface-sunken p-3">
      <p className="text-xs font-semibold tracking-[0.14em] text-status-med uppercase">
        {single ? 'Minimum effective dose' : 'Minimum effective dose — either'}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {protocol.medOptions.map((option) => (
          <li key={option.id} className="text-xs leading-relaxed text-text-secondary">
            {single ? null : (
              <span className="font-semibold text-text-primary">{option.label}. </span>
            )}
            {option.body}
            <Artefacts body={option.body} artefacts={artefacts} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The member's own words, where the MED asks for them.
 *
 * The Morning Protocol says "read the Top G Code aloud". Printing that instruction without the
 * Code is friction at exactly the wrong moment — the low-energy morning the MED exists to
 * rescue. So it is here, not two screens away.
 */
function Artefacts({
  body,
  artefacts,
}: {
  body: string;
  artefacts: ProtocolRowProps['artefacts'];
}) {
  const needs = medReferences(body);
  const shown: { term: string; detail: string | null }[] = [];
  if (needs.topGCode) shown.push({ term: 'Your Top G Code', detail: artefacts.topGCode });
  if (needs.commandPost) shown.push({ term: 'Your Command Post', detail: artefacts.commandPostNote });
  if (needs.fortressProtocol) {
    shown.push({ term: 'Your Fortress Protocol', detail: artefacts.fortressProtocol });
  }
  if (shown.length === 0) return null;

  return (
    <dl className="mt-2 flex flex-col gap-2 border-l-2 border-status-med pl-3">
      {shown.map((item) => (
        <div key={item.term}>
          <dt className="text-xs font-semibold text-text-muted">{item.term}</dt>
          <dd className="text-xs leading-relaxed text-text-primary">
            {/* Said plainly when it is missing rather than left blank: a silent gap looks like a
                rendering fault, and he cannot fix what he has not been told about. */}
            {item.detail ?? <span className="text-text-muted">Not written yet — set it in Profile.</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
