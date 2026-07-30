import * as RadioGroup from '@radix-ui/react-radio-group';
import {
  ATTACK_OUTCOMES,
  FIELD_CAP,
  OUTCOME_LABELS,
  TRIGGER_KINDS,
  TRIGGER_LABELS,
  blockers,
  formatHour,
  insightState,
  type AttackOutcome,
  type DebriefDraft,
  type TriggerKind,
} from '@/features/forge/debrief-draft';
import type { ProtocolWithMed } from '@/features/forge/sitrep-draft';
import { Button } from '@/ui/Button';

/**
 * The debrief, with no data access in it.
 *
 * Presentational for the same reason SitrepForm is: it can then be driven in a real browser with
 * no credentials, which is where the interaction claims get tested rather than asserted.
 *
 * The wording throughout comes from DOCTRINE §6, and one rule governs all of it: **name the
 * enemy's manoeuvre, do not blame the man.** "I was weak and ate a cookie" produces shame and no
 * intelligence. "Ambush at 15:00 using low energy as the trigger" produces a countermeasure. Every
 * label here is written from the second stance, because the field labels are the instruction — a
 * man reads them daily and nothing else in the app tells him how to think about a loss.
 */

export type DebriefState = 'idle' | 'working' | 'sent' | 'held' | 'refused' | 'lost';

export interface DebriefFormProps {
  draft: DebriefDraft;
  /** The trigger is held apart from the draft so "attacked but not yet named" is representable. */
  triggerKind: TriggerKind | null;
  /** Protocols live today, offered as the thing defended or attacked. */
  protocols: readonly ProtocolWithMed[];
  /** His current hour, pre-selected — most attacks are logged shortly after they land. */
  currentHour: number;
  state: DebriefState;
  statusMessage: string;
  refusal: string | null;
  alreadyFiled: boolean;
  onChange: (patch: Partial<DebriefDraft>) => void;
  onTrigger: (kind: TriggerKind) => void;
  onFile: () => void;
}

export function DebriefForm({
  draft,
  triggerKind,
  protocols,
  currentHour,
  state,
  statusMessage,
  refusal,
  alreadyFiled,
  onChange,
  onTrigger,
  onFile,
}: DebriefFormProps) {
  const remaining = blockers(draft);
  const ready = remaining.length === 0 && (!draft.attacked || triggerKind !== null);

  return (
    <section
      aria-labelledby="debrief-heading"
      data-testid="debrief"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <header>
        <h2
          id="debrief-heading"
          className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
        >
          Debrief
        </h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          Two questions. What worked, and what the enemy tried. Answered in fields rather than
          paragraphs so that in thirty days it can tell you something a chat channel cannot.
        </p>
      </header>

      {alreadyFiled ? (
        <p className="mt-2 text-xs text-text-muted">Already debriefed. Answering again replaces it.</p>
      ) : null}

      {/* ── Top G Insight ─────────────────────────────────────────────── */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-status-pass">Top G Insight</h3>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
          A victory with the cause attached. Not &ldquo;had a good workout&rdquo; — that is a
          feeling. &ldquo;Laying gym clothes out the night before meant I was out the door before
          the Bottom G could negotiate&rdquo; is a system somebody else can steal.
        </p>

        <Capped
          id="debrief-system"
          label="The system you used"
          placeholder="Laid gym clothes out the night before"
          value={draft.systemUsed}
          onChange={(systemUsed) => onChange({ systemUsed })}
        />
        <Capped
          id="debrief-victory"
          label="What it won you"
          placeholder="Out the door before the Bottom G could negotiate"
          value={draft.victory}
          onChange={(victory) => onChange({ victory })}
        />

        <ProtocolPicker
          id="debrief-insight-protocol"
          label="Which protocol it defended"
          protocols={protocols}
          value={draft.insightProtocolId}
          onChange={(insightProtocolId) => onChange({ insightProtocolId })}
        />

        {insightState(draft) === 'empty' ? (
          // Said plainly rather than enforced. A man made to produce an insight every day starts
          // inventing them, and invented intelligence is worse than none.
          <p className="mt-2 text-xs text-text-muted">
            Optional. Leave both blank if today had no clear win.
          </p>
        ) : null}
      </div>

      {/* ── Bottom G Tactic ───────────────────────────────────────────── */}
      <div className="mt-8 border-t border-border-subtle pt-6">
        <h3 className="text-sm font-semibold text-status-fail">Bottom G Tactic</h3>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
          Not what you did wrong — what the enemy did. Time, trigger, and the exact lie. This is
          the half only you and the mentor can read.
        </p>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
            Did the Bottom G attack today?
          </legend>
          <RadioGroup.Root
            className="mt-2 flex gap-2"
            value={draft.attacked === null ? '' : draft.attacked ? 'yes' : 'no'}
            onValueChange={(value) => onChange({ attacked: value === 'yes' })}
            orientation="horizontal"
            loop={false}
          >
            <Choice value="no" label="Quiet day" tone="pass" name="The Bottom G did not attack" />
            <Choice value="yes" label="He attacked" tone="fail" name="The Bottom G attacked" />
          </RadioGroup.Root>
        </fieldset>

        {draft.attacked ? (
          <div data-testid="attack-detail" className="mt-5 flex flex-col gap-5">
            <HourPicker
              value={draft.occurredAtHour}
              currentHour={currentHour}
              onChange={(occurredAtHour) => onChange({ occurredAtHour })}
            />

            <fieldset>
              <legend className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
                What he used as the trigger
              </legend>
              <RadioGroup.Root
                className="mt-2 flex flex-wrap gap-2"
                value={triggerKind ?? ''}
                onValueChange={(value) => onTrigger(value as TriggerKind)}
                orientation="horizontal"
                loop={false}
              >
                {TRIGGER_KINDS.map((kind) => (
                  <Choice
                    key={kind}
                    value={kind}
                    label={TRIGGER_LABELS[kind]}
                    tone="fail"
                    name={`Trigger: ${TRIGGER_LABELS[kind]}`}
                    grow={false}
                  />
                ))}
              </RadioGroup.Root>
            </fieldset>

            <Capped
              id="debrief-propaganda"
              label="The exact lie he told you"
              placeholder="You need a quick boost"
              value={draft.propaganda}
              onChange={(propaganda) => onChange({ propaganda })}
            />

            <ProtocolPicker
              id="debrief-attacked-protocol"
              label="Which protocol he attacked"
              protocols={protocols}
              value={draft.attackedProtocolId}
              onChange={(attackedProtocolId) => onChange({ attackedProtocolId })}
            />

            <fieldset>
              <legend className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
                How it went
              </legend>
              <RadioGroup.Root
                className="mt-2 flex gap-2"
                value={draft.outcome ?? ''}
                onValueChange={(value) => onChange({ outcome: value as AttackOutcome })}
                orientation="horizontal"
                loop={false}
              >
                {ATTACK_OUTCOMES.map((outcome) => (
                  <Choice
                    key={outcome}
                    value={outcome}
                    label={OUTCOME_LABELS[outcome]}
                    tone={outcome === 'resisted' ? 'pass' : outcome === 'partial' ? 'med' : 'fail'}
                    name={`Outcome: ${OUTCOME_LABELS[outcome]}`}
                  />
                ))}
              </RadioGroup.Root>
              <p className="mt-2 text-xs text-text-muted">
                {/* Losing an ambush and never being ambushed are different facts, and only the
                    first one tells him anything. Recording it is not a confession. */}
                Being attacked is not a failure. Losing one is information.
              </p>
            </fieldset>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Button
          onClick={onFile}
          disabled={!ready || state === 'working'}
          data-testid="file-debrief"
          className="w-full"
        >
          {state === 'working' ? 'Filing…' : alreadyFiled ? 'Replace the debrief' : 'File the debrief'}
        </Button>

        {remaining.length > 0 ? (
          <ul data-testid="debrief-blockers" className="flex flex-col gap-1">
            {remaining.map((reason) => (
              <li key={reason} className="text-xs text-text-muted">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}

        {draft.attacked && triggerKind === null && remaining.length === 0 ? (
          <p className="text-xs text-text-muted">Name the trigger he used.</p>
        ) : null}

        <p
          data-testid="debrief-status"
          role="status"
          className={`text-xs leading-relaxed ${
            state === 'sent'
              ? 'text-status-pass'
              : state === 'refused' || state === 'lost'
                ? 'text-status-fail'
                : 'text-text-muted'
          }`}
        >
          {statusMessage}
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

function Choice({
  value,
  label,
  tone,
  name,
  grow = true,
}: {
  value: string;
  label: string;
  tone: 'pass' | 'med' | 'fail';
  name: string;
  grow?: boolean;
}) {
  const on = {
    pass: 'data-[state=checked]:border-status-pass data-[state=checked]:bg-status-pass data-[state=checked]:text-accent-ink',
    med: 'data-[state=checked]:border-status-med data-[state=checked]:bg-status-med data-[state=checked]:text-accent-ink',
    fail: 'data-[state=checked]:border-status-fail data-[state=checked]:bg-status-fail data-[state=checked]:text-accent-ink',
  }[tone];

  return (
    <RadioGroup.Item
      value={value}
      aria-label={name}
      className={`min-h-11 rounded-[var(--radius-sm)] border border-border-strong px-3 text-xs font-semibold tracking-wide text-text-secondary transition-colors ${
        grow ? 'flex-1' : ''
      } ${on}`}
    >
      {label}
    </RadioGroup.Item>
  );
}

/**
 * The hour the attack landed.
 *
 * A native `<select>` rather than a grid of twenty-four buttons: this is one field among several
 * on a screen that is not on the sixty-second budget, and a phone's native picker is faster and
 * more accessible than anything hand-rolled. Defaulted to his current hour because a man logs an
 * ambush shortly after surviving it — the common case should cost nothing.
 */
function HourPicker({
  value,
  currentHour,
  onChange,
}: {
  value: number | null;
  currentHour: number;
  onChange: (hour: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor="debrief-hour"
        className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase"
      >
        What hour it landed
      </label>
      <select
        id="debrief-hour"
        data-numeral
        value={value === null ? '' : String(value)}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        className="mt-2 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
      >
        <option value="" disabled>
          Choose the hour
        </option>
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>
            {formatHour(hour)}
            {hour === currentHour ? ' — now' : ''}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-text-muted">
        {/* Said out loud because it is the claim the whole feature rests on, and because a man
            filing from a hotel in another country needs to know which clock is meant. */}
        Your local time. This is the column that eventually tells you when he attacks.
      </p>
    </div>
  );
}

function ProtocolPicker({
  id,
  label,
  protocols,
  value,
  onChange,
}: {
  id: string;
  label: string;
  protocols: readonly ProtocolWithMed[];
  value: string | null;
  onChange: (protocolId: string | null) => void;
}) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="mt-2 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
      >
        <option value="">Not tied to one</option>
        {protocols.map((protocol) => (
          <option key={protocol.id} value={protocol.id}>
            {protocol.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A capped single-line field.
 *
 * The count appears only in the last twenty characters. A counter that is always visible turns
 * every field into a budget to spend, which is the opposite of the intent — the cap exists to
 * force a specific claim, not to invite one exactly 140 characters long.
 */
function Capped({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const left = FIELD_CAP - value.length;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
          {label}
        </label>
        {left <= 20 ? (
          <span
            data-numeral
            className={`text-xs ${left < 0 ? 'text-status-fail' : 'text-text-muted'}`}
          >
            {left}
          </span>
        ) : null}
      </div>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        // Not maxLength: a hard stop mid-word looks like the app broke. The count warns, the
        // blocker explains, and app.capped_text_140 is what actually enforces it.
        className="mt-2 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary placeholder:text-text-muted"
      />
    </div>
  );
}
