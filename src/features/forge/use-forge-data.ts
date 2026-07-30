import { useCallback, useEffect, useState } from 'react';
import { getLocalDateString } from '@/lib/date';
import { getSupabase } from '@/lib/supabase';
import type { ProtocolStatus } from '@/features/forge/doctrine';
import type { ProtocolWithMed, SitrepDraft } from '@/features/forge/sitrep-draft';
import type { AttackRecord, DebriefDraft, TriggerKind } from '@/features/forge/debrief-draft';

/**
 * Everything the Forge reads, loaded once.
 *
 * Lifted out of the screen because of a bug the tabs made obvious: Radix unmounts an inactive
 * `Tabs.Content`, and Today and Intel each mounted their own screen — so every switch between
 * them tore one down, built the other, and re-ran the whole load. Nine sequential round trips,
 * every tap on a tab.
 *
 * The fix is structural rather than a cache: the data belongs to the session, not to a panel, so
 * the shell owns it and hands it down. Switching tabs is now free.
 *
 * The queries that do not depend on each other are also issued together. The chain that remains
 * is genuine — the campaign identifies the protocols and the enrollment, the enrollment
 * identifies today's SITREP, and the SITREP identifies its debrief.
 */

export interface Campaign {
  id: string;
  name: string;
  startsOn: string;
  lengthDays: number;
}

export interface Enrollment {
  id: string;
  startedOn: string;
}

export interface Loaded {
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

async function loadForge(profileId: string, today: string): Promise<Loaded | null> {
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

  // The catalogue and his enrollment both hang off the campaign and off nothing else.
  const [protocolResult, enrollmentResult] = await Promise.all([
    supabase
      .from('protocols')
      .select(
        'id, slug, label, nickname, kind, activates_on_day, is_treason_trigger, visibility, sort_order, protocol_med_options(id, label, body, sort_order)',
      )
      .eq('campaign_id', campaign.id)
      .order('sort_order'),
    supabase
      .from('enrollments')
      .select('id, started_on')
      .eq('profile_id', profileId)
      .eq('campaign_id', campaign.id)
      .eq('status', 'active')
      .limit(1),
  ]);
  const { data: protocolRows, error: protocolError } = protocolResult;
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

  const { data: enrollmentRows, error: enrollmentError } = enrollmentResult;
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

  // Three independent reads, issued together. Sequentially they were three round trips for data
  // that shares no dependency — and on a phone on mobile data a round trip is not free.
  const [attackResult, outcomeResult, historyResult] = await Promise.all([
    supabase
      .from('bottom_g_tactics')
      .select('occurred_at_hour, trigger_kind, sitreps!inner(id, enrollments!inner(profile_id))')
      .eq('sitreps.enrollments.profile_id', profileId),
    supabase.from('debriefs').select('sitrep_id, outcome').not('outcome', 'is', null),
    supabase
      .from('sitreps')
      .select('local_date, final_status')
      .eq('enrollment_id', enrollment.id)
      .order('local_date', { ascending: false }),
  ]);

  // The outcome lives on `debriefs`, so it is joined back through the sitrep rather than
  // duplicated onto the tactic — one fact, one place.
  const outcomeBySitrep = new Map(
    ((outcomeResult.data ?? []) as { sitrep_id: string; outcome: string }[]).map((row) => [
      row.sitrep_id,
      row.outcome,
    ]),
  );

  const attacks: AttackRecord[] = ((attackResult.data ?? []) as unknown as {
    occurred_at_hour: number;
    trigger_kind: TriggerKind;
    sitreps: { id: string } | null;
  }[]).flatMap((row) => {
    const outcome = row.sitreps ? outcomeBySitrep.get(row.sitreps.id) : undefined;
    // An attack with no readable outcome is dropped rather than defaulted. Guessing 'lost' would
    // inflate the very number the pattern panel exists to report honestly.
    if (outcome !== 'resisted' && outcome !== 'partial' && outcome !== 'lost') return [];
    return [{ occurredAtHour: row.occurred_at_hour, triggerKind: row.trigger_kind, outcome }];
  });

  const outcomes = ((historyResult.data ?? []) as { local_date: string; final_status: string }[]).map(
    (row) => ({
      localDate: row.local_date,
      finalStatus: row.final_status as 'complete' | 'repeat' | 'reset',
    }),
  );

  return { campaign, enrollment, protocols, filed, sitrepId, filedDebrief, attacks, outcomes };
}

export interface ForgeData {
  loaded: Loaded | null;
  error: string | null;
  /** His today, in his own timezone. Shared so the screen and the header cannot disagree. */
  today: string;
  reload: () => void;
  joining: boolean;
  join: () => Promise<void>;
}

export function useForgeData(profileId: string, timezone: string): ForgeData {
  // Today, in his timezone. Never from toISOString() — see src/lib/date.ts.
  const today = getLocalDateString(timezone);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    // The shell calls this before the profile has resolved, because hooks cannot be conditional.
    // Querying with an empty id would ask the database for another man's rows — RLS would return
    // nothing, but the honest thing is not to ask.
    if (!profileId) return;
    let cancelled = false;
    // State is set only from the promise callbacks, never synchronously in the effect body. A
    // stale error is cleared by whatever triggered the reload, which is where clearing it belongs.
    loadForge(profileId, today)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load the campaign.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, today, token]);

  const reload = useCallback(() => {
    setError(null);
    setToken((value) => value + 1);
  }, []);

  const join = useCallback(async () => {
    const campaignId = loaded?.campaign.id;
    if (!campaignId) return;
    setJoining(true);
    setError(null);
    const { error: rpcError } = await getSupabase().rpc('start_campaign_enrollment', {
      p_campaign_id: campaignId,
    });
    if (rpcError) setError(rpcError.message);
    else setToken((value) => value + 1);
    setJoining(false);
  }, [loaded]);

  return { loaded, error, today, reload, joining, join };
}
