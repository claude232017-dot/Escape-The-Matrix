import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { getSupabase } from '@/lib/supabase';
import {
  emptyToNull,
  firstError,
  LIMITS,
  validateCapped,
  validateDisplayName,
  validateTimezone,
} from '@/lib/field-validation';
import { timezoneLabel, timezoneOptions } from '@/lib/timezones';

/**
 * A member's own profile.
 *
 * Exists ahead of the Forge because three of Phase 2's minimum effective doses reference
 * things that live here and had no way of being written:
 *
 *   - the **Top G Code**, which the Morning Protocol MED shows inline at the moment it is
 *     meant to be read aloud — a MED that says "read your Code" without showing the Code is
 *     friction at exactly the wrong moment;
 *   - the **Command Post**, his physical workspace;
 *   - the **Fortress Protocol**, his rules for uninterrupted work.
 *
 * And the timezone, which until now could only be set at signup. That is the sharp one: it
 * decides every day count, week boundary and SITREP deadline, so a wrong value stops being
 * cosmetic the moment the Forge starts writing dates against it.
 *
 * Takes its values as props rather than reading the auth context, so this feature does not
 * import that one. The composition root wires them.
 */

export interface ProfileFields {
  displayName: string;
  timezone: string;
  topGCode: string | null;
  commandPostNote: string | null;
  fortressProtocol: string | null;
}

export function ProfileScreen({
  profileId,
  initial,
  onSaved,
  onClose,
}: {
  profileId: string;
  initial: ProfileFields;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [topGCode, setTopGCode] = useState(initial.topGCode ?? '');
  const [commandPost, setCommandPost] = useState(initial.commandPostNote ?? '');
  const [fortress, setFortress] = useState(initial.fortressProtocol ?? '');
  const [problem, setProblem] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const zones = useMemo(() => timezoneOptions(), []);
  const zoneLabels = useMemo(() => new Map(zones.map((z) => [z, timezoneLabel(z)])), [zones]);

  // A zone the database would reject can only get here if it was written before the CHECK
  // existed, or by hand. Better to show it as a selectable oddity than to silently swap it for
  // something else and change which day his reports land on.
  const zoneList = useMemo(
    () => (zones.includes(timezone) ? zones : [timezone, ...zones]),
    [zones, timezone],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = firstError(
      validateDisplayName(displayName),
      validateTimezone(timezone),
      validateCapped('topGCode', topGCode),
      validateCapped('commandPostNote', commandPost),
      validateCapped('fortressProtocol', fortress),
    );
    if (found) {
      setProblem(found);
      return;
    }
    setProblem(null);
    setBusy(true);
    setSaved(false);
    try {
      const { error } = await getSupabase()
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          timezone,
          // null, not '': the column is nullable and the two mean different things. The
          // Morning Protocol MED needs to know whether there is a Code to show at all.
          top_g_code: emptyToNull(topGCode),
          command_post_note: emptyToNull(commandPost),
          fortress_protocol: emptyToNull(fortress),
        })
        // Redundant against the RLS policy, which already restricts this to his own row.
        // Kept because a mistake here would otherwise be a silent no-op rather than an error.
        .eq('id', profileId);
      if (error) throw error;
      setSaved(true);
      await onSaved();
    } catch (cause) {
      setProblem({
        field: 'form',
        message:
          cause instanceof Error && cause.message
            ? cause.message
            : 'Could not save. Try again in a moment.',
      });
    } finally {
      setBusy(false);
    }
  }

  const errorFor = (field: string) => (problem?.field === field ? problem.message : null);
  const changed =
    displayName !== initial.displayName ||
    timezone !== initial.timezone ||
    emptyToNull(topGCode) !== initial.topGCode ||
    emptyToNull(commandPost) !== initial.commandPostNote ||
    emptyToNull(fortress) !== initial.fortressProtocol;

  return (
    <section
      aria-labelledby="profile-heading"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="profile-heading"
          className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
        >
          Your profile
        </h2>
        <Button variant="quiet" onClick={onClose} disabled={busy}>
          Close
        </Button>
      </div>

      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-5" noValidate>
        <Field
          label="Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint="What the circle sees."
          error={errorFor('displayName')}
          required
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="profile-timezone"
            className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
          >
            Timezone
          </label>
          <select
            id="profile-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="profile-timezone-hint"
            className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-base text-text-primary"
          >
            {zoneList.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabels.get(zone) ?? zone}
              </option>
            ))}
          </select>
          <p id="profile-timezone-hint" className="text-xs text-text-muted">
            Your day rolls over at midnight here, and this is the clock every deadline is
            measured against. Change it if you have moved — past reports keep the dates they
            were filed under.
          </p>
          {errorFor('timezone') ? (
            <p role="alert" className="text-xs text-status-fail">
              {errorFor('timezone')}
            </p>
          ) : null}
        </div>

        <CappedTextarea
          id="profile-top-g-code"
          label="Top G Code"
          value={topGCode}
          onChange={setTopGCode}
          max={LIMITS.topGCode.max}
          rows={6}
          hint="Your creed, in your own words. The Morning Protocol shows this back to you when it asks you to read it aloud — so write it to be read, not to be filed."
          error={errorFor('topGCode')}
        />

        <CappedTextarea
          id="profile-command-post"
          label="Command Post"
          value={commandPost}
          onChange={setCommandPost}
          max={LIMITS.commandPostNote.max}
          rows={3}
          hint="Where you go to work. Specific enough that “go to the Command Post” means one place and not a mood."
          error={errorFor('commandPostNote')}
        />

        <CappedTextarea
          id="profile-fortress"
          label="Fortress Protocol"
          value={fortress}
          onChange={setFortress}
          max={LIMITS.fortressProtocol.max}
          rows={4}
          hint="Your rules for uninterrupted work — phone where, notifications how, door open or shut. Deep Work is measured against these."
          error={errorFor('fortressProtocol')}
        />

        {errorFor('form') ? (
          <p role="alert" className="text-sm text-status-fail">
            {errorFor('form')}
          </p>
        ) : null}
        {saved && !changed ? (
          <p role="status" className="text-sm text-status-pass">
            Saved.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy || !changed}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * A capped textarea with a live remaining count.
 *
 * The counter is not decoration: these caps are database constraints, so without it a man
 * writes his creed, presses Save and is told the length is wrong after the fact. Showing the
 * remaining characters makes the limit a fact he can work with rather than a rejection.
 */
function CappedTextarea({
  id,
  label,
  value,
  onChange,
  max,
  rows,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  max: number;
  rows: number;
  hint: string;
  error: string | null;
}) {
  const remaining = max - value.length;
  const describedBy = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
        >
          {label}
        </label>
        <span
          data-numeral
          aria-live="polite"
          className={`text-xs ${remaining < 0 ? 'text-status-fail' : 'text-text-muted'}`}
        >
          {remaining}
        </span>
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error || remaining < 0 ? true : undefined}
        aria-describedby={describedBy}
        className={`resize-y rounded-[var(--radius-md)] border bg-surface-base p-3 text-base leading-relaxed text-text-primary ${
          error || remaining < 0 ? 'border-status-fail' : 'border-border-strong'
        }`}
      />
      <p id={describedBy} className={`text-xs ${error ? 'text-status-fail' : 'text-text-muted'}`}>
        {error ?? hint}
      </p>
    </div>
  );
}
