import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { campaignDay, getLocalDateString } from '@/lib/date';
import { readScoped, writeScoped, type StorageLike } from '@/lib/local-state';
import type { OutboxEntry } from '@/lib/outbox';
import { activeProtocols, currentStreak, type ProtocolStatus } from '@/features/forge/doctrine';
import { getSupabase } from '@/lib/supabase';
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
import { describeQueue, useOutbox } from '@/features/forge/use-outbox';
import { SitrepForm, type FileState } from '@/features/forge/components/SitrepForm';
import { DebriefForm } from '@/features/forge/components/DebriefForm';
import {
  debriefKey,
  emptyDebrief,
  localHour,
  toPayload as toDebriefPayload,
  type AttackRecord,
  type DebriefDraft,
  type DebriefPayload,
  type TriggerKind,
} from '@/features/forge/debrief-draft';
import { debriefRefusalMessage, sendDebrief } from '@/features/forge/debrief-write';
import { AttackPatternPanel } from '@/features/forge/components/AttackPatternPanel';
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

interface Campaign {
  id: string;
  name: string;
  startsOn: string;
  lengthDays: number;
}

interface Enrollment {
  id: string;
  startedOn: string;
}

interface Loaded {
  campaign: Campaign;
  enrollment: Enrollment | null;
  protocols: ProtocolWithMed[];
  /** Results already on the server for today, keyed by slug. */
  filed: SitrepDraft | null;
  /** Today's SITREP row. Null until the day is filed — a debrief hangs off a filed day. */
  sitrepId: string | null;
  /** The debrief already on the server for today, if any. */
  filedDebrief: { draft: DebriefDraft; triggerKind: TriggerKind | null } | null;
  /** Every attack he has logged, for the pattern readback. */
  attacks: AttackRecord[];
  /** This enrollment's filed days, newest first, for the streak. */
  outcomes: { localDate: string; finalStatus: 'complete' | 'repeat' | 'reset' }[];
}

interface MedOptionRow {
  id: string;
  label: string;
  body: string;
  sort_order: number;
}

interface ProtocolRowData {
  id: string;
  slug: string;
  label: string;
  nickname: string | null;
  kind: 'duty' | 'prohibition';
  activates_on_day: number;
  is_treason_trigger: boolean;
  visibility: 'itemised' | 'aggregate_only';
  protocol_med_options: MedOptionRow[] | null;
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

export function ForgeScreen({ view, profileId, timezone, artefacts, onState }: ForgeScreenProps) {
  // Today, in his timezone. Never from toISOString() — see src/lib/date.ts. Recomputed on each
  // load rather than memoised for the session, because a tab left open overnight must roll over.
  const today = useMemo(() => getLocalDateString(timezone), [timezone]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SitrepDraft>(emptyDraft);
  const [fileState, setFileState] = useState<FileState>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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

  const load = useCallback(async (): Promise<Loaded | null> => {
    const supabase = getSupabase();

    const { data: campaignRows, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, name, starts_on, length_days')
      .order('starts_on', { ascending: false })
      .limit(1);
    if (campaignError) throw new Error(campaignError.message);
    const campaignRow = campaignRows?.[0];
    if (!campaignRow) return null;

    const campaign: Campaign = {
      id: campaignRow.id as string,
      name: campaignRow.name as string,
      startsOn: campaignRow.starts_on as string,
      lengthDays: campaignRow.length_days as number,
    };

    const { data: protocolRows, error: protocolError } = await supabase
      .from('protocols')
      .select(
        'id, slug, label, nickname, kind, activates_on_day, is_treason_trigger, visibility, sort_order, protocol_med_options(id, label, body, sort_order)',
      )
      .eq('campaign_id', campaign.id)
      .order('sort_order');
    if (protocolError) throw new Error(protocolError.message);

    const protocols: ProtocolWithMed[] = ((protocolRows ?? []) as unknown as ProtocolRowData[]).map(
      (row) => ({
        id: row.id,
        slug: row.slug,
        label: row.label,
        nickname: row.nickname,
        kind: row.kind,
        activatesOnDay: row.activates_on_day,
        isTreasonTrigger: row.is_treason_trigger,
        visibility: row.visibility,
        medOptions: [...(row.protocol_med_options ?? [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((option) => ({ id: option.id, label: option.label, body: option.body })),
      }),
    );

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('id, started_on')
      .eq('profile_id', profileId)
      .eq('campaign_id', campaign.id)
      .eq('status', 'active')
      .limit(1);
    if (enrollmentError) throw new Error(enrollmentError.message);
    const enrollmentRow = enrollmentRows?.[0];
    if (!enrollmentRow) {
      return {
        campaign,
        enrollment: null,
        protocols,
        filed: null,
        sitrepId: null,
        filedDebrief: null,
        attacks: [],
        outcomes: [],
      };
    }

    const enrollment: Enrollment = {
      id: enrollmentRow.id as string,
      startedOn: enrollmentRow.started_on as string,
    };

    const { data: sitrepRows, error: sitrepError } = await supabase
      .from('sitreps')
      .select('id, protocol_results(protocol_id, status, med_option_id)')
      .eq('enrollment_id', enrollment.id)
      .eq('local_date', today)
      .limit(1);
    if (sitrepError) throw new Error(sitrepError.message);

    const bySlug = new Map(protocols.map((protocol) => [protocol.id, protocol.slug]));
    const results = (sitrepRows?.[0]?.protocol_results ?? []) as unknown as {
      protocol_id: string;
      status: ProtocolStatus;
      med_option_id: string | null;
    }[];

    const filed: SitrepDraft | null = sitrepRows?.[0]
      ? Object.fromEntries(
          results.flatMap((result) => {
            const slug = bySlug.get(result.protocol_id);
            return slug ? [[slug, { status: result.status, medOptionId: result.med_option_id }]] : [];
          }),
        )
      : null;

    const sitrepId = (sitrepRows?.[0]?.id as string | undefined) ?? null;

    // The debrief for today, and every attack he has ever logged. Two queries rather than one
    // join: the pattern spans enrollments on purpose — a reset returns his day count to 1, but it
    // does not make him a different man, and the enemy's timetable does not restart with it.
    let filedDebrief: Loaded['filedDebrief'] = null;
    if (sitrepId) {
      const { data: debriefRows, error: debriefError } = await supabase
        .from('debriefs')
        .select(
          'system_used, victory, insight_protocol_id, attacked, outcome, bottom_g_tactics:bottom_g_tactics!inner(occurred_at_hour, trigger_kind, propaganda, protocol_id)',
        )
        .eq('sitrep_id', sitrepId)
        .limit(1);
      // A quiet day has no tactic row, so the inner join returns nothing. Fall back to the
      // debrief alone rather than treating "no attack" as "no debrief".
      const withTactic = debriefError ? null : (debriefRows?.[0] ?? null);
      const row =
        withTactic ??
        (
          await supabase
            .from('debriefs')
            .select('system_used, victory, insight_protocol_id, attacked, outcome')
            .eq('sitrep_id', sitrepId)
            .limit(1)
        ).data?.[0] ??
        null;

      if (row) {
        const record = row as Record<string, unknown>;
        const tactic = (record['bottom_g_tactics'] as Record<string, unknown>[] | undefined)?.[0];
        filedDebrief = {
          draft: {
            systemUsed: (record['system_used'] as string | null) ?? '',
            victory: (record['victory'] as string | null) ?? '',
            insightProtocolId: (record['insight_protocol_id'] as string | null) ?? null,
            attacked: record['attacked'] as boolean,
            outcome: (record['outcome'] as DebriefDraft['outcome']) ?? null,
            occurredAtHour: (tactic?.['occurred_at_hour'] as number | undefined) ?? null,
            propaganda: (tactic?.['propaganda'] as string | null) ?? '',
            attackedProtocolId: (tactic?.['protocol_id'] as string | null) ?? null,
          },
          triggerKind: (tactic?.['trigger_kind'] as TriggerKind | undefined) ?? null,
        };
      }
    }

    const { data: attackRows } = await supabase
      .from('bottom_g_tactics')
      .select('occurred_at_hour, trigger_kind, sitreps!inner(id, enrollments!inner(profile_id))')
      .eq('sitreps.enrollments.profile_id', profileId);

    // The outcome lives on `debriefs`, so it is joined back through the sitrep rather than
    // duplicated onto the tactic — one fact, one place.
    const { data: outcomeRows } = await supabase
      .from('debriefs')
      .select('sitrep_id, outcome')
      .not('outcome', 'is', null);
    const outcomeBySitrep = new Map(
      ((outcomeRows ?? []) as { sitrep_id: string; outcome: string }[]).map((row) => [
        row.sitrep_id,
        row.outcome,
      ]),
    );

    const attacks: AttackRecord[] = ((attackRows ?? []) as unknown as {
      occurred_at_hour: number;
      trigger_kind: TriggerKind;
      sitreps: { id: string } | null;
    }[]).flatMap((row) => {
      const outcome = row.sitreps ? outcomeBySitrep.get(row.sitreps.id) : undefined;
      // An attack with no readable outcome is dropped rather than defaulted. Guessing 'lost'
      // would inflate the very number this panel exists to report honestly.
      if (outcome !== 'resisted' && outcome !== 'partial' && outcome !== 'lost') return [];
      return [
        { occurredAtHour: row.occurred_at_hour, triggerKind: row.trigger_kind, outcome },
      ];
    });

    const { data: outcomeHistory } = await supabase
      .from('sitreps')
      .select('local_date, final_status')
      .eq('enrollment_id', enrollment.id)
      .order('local_date', { ascending: false });

    const outcomes = ((outcomeHistory ?? []) as { local_date: string; final_status: string }[]).map(
      (row) => ({
        localDate: row.local_date,
        finalStatus: row.final_status as 'complete' | 'repeat' | 'reset',
      }),
    );

    return { campaign, enrollment, protocols, filed, sitrepId, filedDebrief, attacks, outcomes };
  }, [profileId, today]);

  useEffect(() => {
    let cancelled = false;
    // State is set only from the promise callbacks, never synchronously in the effect body. A
    // stale error is cleared by whatever triggered the reload — onJoin and onFile both do — which
    // is also where clearing it belongs.
    load()
      .then((result) => {
        if (cancelled) return;
        setLoaded(result);
        if (!result?.enrollment) return;

        // The server's version of today wins over a local draft: it is what actually happened, and
        // a stale draft silently overwriting a filed day is the failure mode worth avoiding. A
        // local draft is only used when nothing has been filed yet.
        const store = storage();
        const local = store
          ? readScoped<SitrepDraft>(
              store,
              profileId,
              draftStorageName(result.enrollment.id, today),
            )
          : null;
        setDraft(result.filed ?? local ?? emptyDraft());
        setDebrief(result.filedDebrief?.draft ?? emptyDebrief());
        setTriggerKind(result.filedDebrief?.triggerKind ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'Could not load the campaign.');
      });
    return () => {
      cancelled = true;
    };
  }, [load, profileId, today, reloadToken]);

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
        setReloadToken((token) => token + 1);
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
  }, [day, draft, loaded, outbox, today]);

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
        setReloadToken((token) => token + 1);
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
  }, [debrief, loaded?.sitrepId, outbox, triggerKind]);

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

  const onJoin = useCallback(async () => {
    if (!loaded?.campaign) return;
    setJoining(true);
    setLoadError(null);
    const { error } = await getSupabase().rpc('start_campaign_enrollment', {
      p_campaign_id: loaded.campaign.id,
    });
    if (error) setLoadError(error.message);
    else setReloadToken((token) => token + 1);
    setJoining(false);
  }, [loaded]);

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
        <Button className="mt-4" onClick={() => void onJoin()} disabled={joining}>
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
