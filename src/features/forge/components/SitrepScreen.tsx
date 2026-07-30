import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { campaignDay, getLocalDateString } from '@/lib/date';
import { readScoped, writeScoped, type StorageLike } from '@/lib/local-state';
import type { OutboxEntry } from '@/lib/outbox';
import type { ProtocolStatus } from '@/features/forge/doctrine';
import { getSupabase } from '@/lib/supabase';
import {
  draftKey,
  emptyDraft,
  evaluateDraft,
  setMedOption,
  setStatus,
  toPayload,
  type ProtocolWithMed,
  type SitrepDraft,
  type SitrepPayload,
} from '@/features/forge/sitrep-draft';
import { refusalMessage, sendSitrep } from '@/features/forge/sitrep-write';
import { describeQueue, useOutbox } from '@/features/forge/use-outbox';
import { SitrepForm, type FileState } from '@/features/forge/components/SitrepForm';
import { Button } from '@/ui/Button';

/**
 * The SITREP, wired to the database.
 *
 * All the presentation is in SitrepForm, which takes only values — that separation is what lets
 * the sixty-second gate be measured in a real browser with no credentials. This file is the part
 * that cannot be: which campaign, which enrollment, what has already been filed today.
 *
 * Takes the profile as **props** rather than reading the auth context, so the Forge does not
 * import the auth feature. The composition root wires them; the import-graph test rejects
 * cross-feature imports.
 */

export interface SitrepScreenProps {
  profileId: string;
  timezone: string;
  artefacts: {
    topGCode: string | null;
    commandPostNote: string | null;
    fortressProtocol: string | null;
  };
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

export function SitrepScreen({ profileId, timezone, artefacts }: SitrepScreenProps) {
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

  const send = useCallback(
    async (entry: OutboxEntry) => {
      await sendSitrep(entry.payload as SitrepPayload);
    },
    [],
  );
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
    if (!enrollmentRow) return { campaign, enrollment: null, protocols, filed: null };

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

    return { campaign, enrollment, protocols, filed };
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
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5">
      {children}
    </section>
  );
}
