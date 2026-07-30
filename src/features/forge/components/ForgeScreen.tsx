import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { campaignDay } from '@/lib/date';
import { readScoped, writeScoped, type StorageLike } from '@/lib/local-state';
import type { OutboxEntry } from '@/lib/outbox';
import { activeProtocols, currentStreak, type ProtocolStatus } from '@/features/forge/doctrine';
import {
  draftKey,
  emptyDraft,
  evaluateDraft,
  setMedOption,
  setStatus,
  toPayload,
  unanswered,
  type ProtocolWithMed,
  type SitrepDraft,
  type SitrepPayload,
} from '@/features/forge/sitrep-draft';
import { refusalMessage, sendSitrep } from '@/features/forge/sitrep-write';
import { describeQueue, useOutbox } from '@/lib/use-outbox';
import { SitrepForm, type FileState } from '@/features/forge/components/SitrepForm';
import { DebriefForm } from '@/features/forge/components/DebriefForm';
import {
  debriefKey,
  emptyDebrief,
  localHour,
  toPayload as toDebriefPayload,
  type DebriefDraft,
  type DebriefPayload,
  type TriggerKind,
} from '@/features/forge/debrief-draft';
import { debriefRefusalMessage, sendDebrief } from '@/features/forge/debrief-write';
import { AttackPatternPanel } from '@/features/forge/components/AttackPatternPanel';
import { InsightList } from '@/features/forge/components/InsightList';
import type { ForgeData, Loaded } from '@/features/forge/use-forge-data';
import { Button } from '@/ui/Button';

/**
 * The Forge, wired to the database.
 *
 * All the presentation is in SitrepForm, DebriefForm and AttackPatternPanel, which take only
 * values — that separation is what lets the sixty-second gate be measured in a real browser with
 * no credentials. This file is the part that cannot be: which campaign, which enrollment, what
 * has already been filed today.
 *
 * Renders one of two views from the same loaded data. `today` is what has to happen before
 * midnight; `intel` is what the record now says. They share a component because they share a
 * query — mounting two screens that each load the campaign would double every read for a man who
 * switches tabs.
 *
 * Takes the profile as **props** rather than reading the auth context, so the Forge does not
 * import the auth feature. The composition root wires them; the import-graph test rejects
 * cross-feature imports.
 */

/** What the shell needs to render the campaign header and the Today badge. */
export interface ForgeView {
  day: number;
  lengthDays: number;
  campaignName: string;
  streak: number;
  filedToday: boolean;
  /** Active protocols still unanswered today. Zero once the day is filed. */
  outstanding: number;
}

export interface ForgeScreenProps {
  view: 'today' | 'intel';
  /** Loaded once by the shell — see @/features/forge/use-forge-data. */
  data: ForgeData;
  profileId: string;
  timezone: string;
  artefacts: {
    topGCode: string | null;
    commandPostNote: string | null;
    fortressProtocol: string | null;
  };
  /** Lifted so the header can show the day without loading the campaign a second time. */
  onState?: (view: ForgeView) => void;
}

function storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A half-filled day, kept on the device. Not a write — just the taps he has already made. */
function draftStorageName(enrollmentId: string, localDate: string): string {
  // scopedKey rejects colons, so the parts are joined with hyphens rather than reusing draftKey().
  return `sitrep-draft-${enrollmentId}-${localDate}`;
}

export function ForgeScreen({ view, data, profileId, timezone, artefacts, onState }: ForgeScreenProps) {
  const { loaded, error: loadError, today, reload, joining, join } = data;
  const [draft, setDraft] = useState<SitrepDraft>(emptyDraft);
  const [fileState, setFileState] = useState<FileState>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);

  const [debrief, setDebrief] = useState<DebriefDraft>(emptyDebrief);
  const [triggerKind, setTriggerKind] = useState<TriggerKind | null>(null);
  const [debriefState, setDebriefState] = useState<FileState>('idle');
  const [debriefRefusal, setDebriefRefusal] = useState<string | null>(null);

  // One outbox, two kinds of write. Dispatched on the key rather than by sniffing the payload's
  // shape: the key is what the queue coalesces on, so it is the thing guaranteed to be right.
  const send = useCallback(async (entry: OutboxEntry) => {
    if (entry.key.startsWith('debrief:')) {
      await sendDebrief(entry.payload as DebriefPayload);
      return;
    }
    await sendSitrep(entry.payload as SitrepPayload);
  }, []);
  const outbox = useOutbox(profileId, send);


  // Adopt whatever the shell loaded, during render rather than in an effect.
  //
  // React's documented way to reset state when a prop changes: compare against the last value
  // adopted and set during render, which re-renders before anything is painted. The effect version
  // paints once with the previous value and then corrects itself, which on a screen about what a
  // man did today is one frame of the wrong answers.
  //
  // The server's version of today wins over a local draft: it is what actually happened, and a
  // stale draft silently overwriting a filed day is the failure mode worth avoiding. A local draft
  // is used only when nothing has been filed yet.
  const [adopted, setAdopted] = useState<Loaded | null>(null);
  if (loaded !== adopted) {
    setAdopted(loaded);
    if (loaded?.enrollment) {
      const store = storage();
      const local = store
        ? readScoped<SitrepDraft>(store, profileId, draftStorageName(loaded.enrollment.id, today))
        : null;
      setDraft(loaded.filed ?? local ?? emptyDraft());
      setDebrief(loaded.filedDebrief?.draft ?? emptyDebrief());
      setTriggerKind(loaded.filedDebrief?.triggerKind ?? null);
    }
  }

  const enrollmentId = loaded?.enrollment?.id ?? null;

  // Persist the taps he has already made. Deliberately separate from the outbox: this is not a
  // write, it is a partially answered form, and calling it "saved" anywhere would be a lie.
  const persistDraft = useCallback(
    (next: SitrepDraft) => {
      const store = storage();
      if (!store || !enrollmentId) return;
      writeScoped(store, profileId, draftStorageName(enrollmentId, today), next);
    },
    [enrollmentId, profileId, today],
  );

  const onStatus = useCallback(
    (protocol: ProtocolWithMed, status: ProtocolStatus) => {
      setDraft((current) => {
        const next = setStatus(current, protocol, status);
        persistDraft(next);
        return next;
      });
      setRefusal(null);
      setFileState('idle');
    },
    [persistDraft],
  );

  const onMedOption = useCallback(
    (protocol: ProtocolWithMed, optionId: string) => {
      setDraft((current) => {
        const next = setMedOption(current, protocol.slug, optionId);
        persistDraft(next);
        return next;
      });
      setRefusal(null);
      setFileState('idle');
    },
    [persistDraft],
  );

  const day =
    loaded?.enrollment ? campaignDay(loaded.enrollment.startedOn, today) : 1;

  const evaluation = useMemo(
    () =>
      evaluateDraft({
        draft,
        protocols: loaded?.protocols ?? [],
        day,
      }),
    [draft, loaded?.protocols, day],
  );

  const filing = useRef(false);

  const onFile = useCallback(async () => {
    if (filing.current || !loaded?.enrollment) return;
    const payload = toPayload({
      enrollmentId: loaded.enrollment.id,
      localDate: today,
      draft,
      protocols: loaded.protocols,
      day,
    });
    // Null means the day is incomplete. The button is disabled in that state, so reaching here is
    // a bug rather than a user action — and filing a partial day would record silence as a pass.
    if (!payload) return;

    filing.current = true;
    setFileState('working');
    setRefusal(null);
    try {
      const outcome = await outbox.queue(draftKey(loaded.enrollment.id, today), payload);
      if (outcome.sent) {
        setFileState('sent');
        // Re-read rather than patch local state. A reset moved him to a new enrollment on the
        // server, and guessing at that here is how the screen and the database disagree.
        reload();
      } else if (outcome.refused) {
        setFileState('refused');
        setRefusal(refusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      } else if (outcome.lost) {
        setFileState('lost');
      } else {
        setFileState('held');
      }
    } finally {
      filing.current = false;
    }
  }, [day, draft, loaded, outbox, today, reload]);

  const onDebriefChange = useCallback((patch: Partial<DebriefDraft>) => {
    setDebrief((current) => {
      const next = { ...current, ...patch };
      // Amending "he attacked" down to "quiet day" clears the attack fields here as well as in
      // toPayload. Mirror: file_debrief deletes the tactic row, and debriefs_outcome_iff_attacked
      // rejects an outcome with no attack — a stale outcome left on screen would be a claim about
      // a fight that, as far as the record is concerned, never happened.
      if (patch.attacked === false) {
        return {
          ...next,
          outcome: null,
          occurredAtHour: null,
          propaganda: '',
          attackedProtocolId: null,
        };
      }
      return next;
    });
    if (patch.attacked === false) setTriggerKind(null);
    setDebriefRefusal(null);
    setDebriefState('idle');
  }, []);

  const onTrigger = useCallback((kind: TriggerKind) => {
    setTriggerKind(kind);
    setDebriefRefusal(null);
    setDebriefState('idle');
  }, []);

  const filingDebrief = useRef(false);

  const onFileDebrief = useCallback(async () => {
    const sitrepId = loaded?.sitrepId;
    if (filingDebrief.current || !sitrepId) return;
    const payload = toDebriefPayload(sitrepId, debrief, triggerKind);
    if (!payload) return;

    filingDebrief.current = true;
    setDebriefState('working');
    setDebriefRefusal(null);
    try {
      const outcome = await outbox.queue(debriefKey(sitrepId), payload);
      if (outcome.sent) {
        setDebriefState('sent');
        reload();
      } else if (outcome.refused) {
        setDebriefState('refused');
        setDebriefRefusal(debriefRefusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      } else if (outcome.lost) {
        setDebriefState('lost');
      } else {
        setDebriefState('held');
      }
    } finally {
      filingDebrief.current = false;
    }
  }, [debrief, loaded?.sitrepId, outbox, triggerKind, reload]);

  // Lifted to the shell so the campaign header can render the day without a second query. In an
  // effect rather than during render: calling a parent's setState mid-render is the cascading
  // update React warns about, and the header is one frame behind for exactly one frame.
  const streak = useMemo(() => {
    if (!loaded?.enrollment) return 0;
    const byDate = new Map(loaded.outcomes.map((row) => [row.localDate, row.finalStatus]));
    return currentStreak(byDate, today, loaded.enrollment.startedOn);
  }, [loaded, today]);

  useEffect(() => {
    if (!onState || !loaded?.enrollment) return;
    onState({
      day,
      lengthDays: loaded.campaign.lengthDays,
      campaignName: loaded.campaign.name,
      streak,
      filedToday: loaded.filed !== null,
      outstanding: unanswered(draft, loaded.protocols, day).length,
    });
  }, [onState, loaded, day, streak, draft]);

  if (loadError) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-status-fail">
          {loadError}
        </p>
      </Panel>
    );
  }

  if (!loaded) {
    return (
      <Panel>
        <p aria-busy="true" className="text-sm text-text-muted">
          Loading the campaign…
        </p>
      </Panel>
    );
  }

  if (view === 'intel') {
    return (
      <div className="flex flex-col gap-6">
        {/* Wins first. An Intel tab that opens with what beat you is a screen about losing, and
            DOCTRINE §1 only works if the victories are as visible as the defeats. */}
        <InsightList insights={loaded.insights} />
        <AttackPatternPanel attacks={loaded.attacks} />
        {loaded.attacks.length === 0 ? (
          <Panel>
            <h2 className="text-sm font-semibold text-text-primary">Nothing to report yet</h2>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
              Log a Bottom G attack in a debrief and this becomes a record of when he moves and
              what works. It stays empty rather than showing an invented pattern.
            </p>
          </Panel>
        ) : null}
      </div>
    );
  }

  if (!loaded.enrollment) {
    return (
      <Panel>
        <h2 className="text-sm font-semibold text-text-primary">{loaded.campaign.name}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          You are not enrolled yet. Day 1 is the day you start — joining late does not backdate
          you, and the server decides the date, not this page.
        </p>
        <Button className="mt-4" onClick={() => void join()} disabled={joining}>
          {joining ? 'Enrolling…' : 'Start Day 1'}
        </Button>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SitrepForm
        day={day}
        localDate={today}
        campaignLengthDays={loaded.campaign.lengthDays}
        protocols={loaded.protocols}
        draft={draft}
        evaluation={evaluation}
        artefacts={artefacts}
        alreadyFiled={loaded.filed !== null}
        fileState={fileState}
        queueMessage={
          fileState === 'sent' && outbox.status.state === 'empty'
            ? 'Filed. It is on the server.'
            : describeQueue(outbox)
        }
        refusal={refusal}
        onStatus={onStatus}
        onMedOption={onMedOption}
        onFile={() => void onFile()}
      />

      {/* The debrief hangs off a filed day, because it debriefs one. Offering it before the
          SITREP is filed would let a man record what the enemy did on a day he has not yet said
          happened — and the sixty-second budget is for the SITREP alone, so the two are
          deliberately separate steps rather than one long form. */}
      {loaded.sitrepId ? (
        <DebriefForm
          draft={debrief}
          triggerKind={triggerKind}
          protocols={activeProtocols(loaded.protocols, day)}
          currentHour={localHour(timezone)}
          state={debriefState}
          statusMessage={
            debriefState === 'sent' && outbox.status.state === 'empty'
              ? 'Filed. It is on the server.'
              : debriefState === 'idle'
                ? 'Not filed yet.'
                : describeQueue(outbox)
          }
          refusal={debriefRefusal}
          alreadyFiled={loaded.filedDebrief !== null}
          onChange={onDebriefChange}
          onTrigger={onTrigger}
          onFile={() => void onFileDebrief()}
        />
      ) : (
        <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6">
          <h2 className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase">
            Debrief
          </h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
            Available once today&apos;s SITREP is filed. A debrief describes a day you have
            already reported.
          </p>
        </section>
      )}

    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5">
      {children}
    </section>
  );
}
