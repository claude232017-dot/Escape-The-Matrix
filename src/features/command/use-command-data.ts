import { useCallback, useEffect, useState } from 'react';
import { getLocalDateString } from '@/lib/date';
import { getSupabase } from '@/lib/supabase';
import { daysSilent, type MemberDay, type Standing } from '@/features/command/correlation';

/**
 * Everything the Commander's View reads.
 *
 * One query for the grain, one for the circle's names, one for outstanding commitments. The
 * grain query returns **the whole circle** — `member_days` is `security_invoker`, so the
 * policies underneath decide what comes back, and a peer's rows arrive with the money already
 * blanked. Nothing here filters by circle or by role, because a filter written in TypeScript is
 * decoration (§3.3) and would also be a second, drifting copy of the rule.
 */

export interface Directive {
  id: string;
  authorId: string;
  subjectId: string;
  weekStart: string;
  body: string;
}

export interface CommandLoaded {
  /** The signed-in man's own days. */
  mine: MemberDay[];
  /** Everyone's, him included. Money is blanked for anyone he may not see it for. */
  circle: MemberDay[];
  standings: Standing[];
  /**
   * Directives this reader is party to.
   *
   * RLS returns only the ones he wrote or was sent — author or subject, never the circle. So
   * this array is already correctly scoped and nothing filters it here; a filter in TypeScript
   * would be decoration (§3.3) and a second copy of the rule.
   */
  directives: Directive[];
}

export interface CommandData {
  loaded: CommandLoaded | null;
  error: string | null;
  localDate: string;
  reload: () => void;
}

interface DayRow {
  profile_id: string;
  local_date: string;
  final_status: MemberDay['finalStatus'];
  deep_work_blocks: number;
  business_actions: number;
  revenue_minor: string | number;
  currency: string | null;
  currency_count: number;
}

/**
 * Read the grain and assemble the standings.
 *
 * Exported so `tests/api` can drive it against a real PostgREST — the same reason `loadForge`
 * and `loadWeek` are. This one matters more than most: it is the query that would silently
 * return other men's revenue if the view ever lost `security_invoker`, and a test that re-typed
 * it would not be testing the view at all.
 */
export async function loadCommand(profileId: string, today: string): Promise<CommandLoaded> {
  const supabase = getSupabase();

  const [dayResult, profileResult, commitmentResult, directiveResult] = await Promise.all([
    supabase
      .from('member_days')
      .select(
        'profile_id, local_date, final_status, deep_work_blocks, business_actions, revenue_minor, currency, currency_count',
      )
      .order('local_date', { ascending: false }),
    supabase.from('profiles').select('id, display_name'),
    supabase.from('commitments').select('profile_id, outcome').eq('outcome', 'pending'),
    supabase
      .from('mentor_directives')
      .select('id, author_id, subject_id, week_start, body')
      .order('week_start', { ascending: false }),
  ]);

  if (dayResult.error) throw new Error(dayResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);

  const days = ((dayResult.data ?? []) as unknown as DayRow[]).map(
    (r): MemberDay => ({
      profileId: r.profile_id,
      localDate: r.local_date,
      finalStatus: r.final_status,
      deepWorkBlocks: r.deep_work_blocks,
      businessActions: r.business_actions,
      // Postgres bigint arrives as a string through PostgREST. Kept as one — a JS number
      // silently loses pennies above 2^53, and §3.2 forbids that at every layer.
      revenueMinor: String(r.revenue_minor ?? '0'),
      currency: r.currency,
      currencyCount: r.currency_count,
    }),
  );

  const names = new Map(
    ((profileResult.data ?? []) as { id: string; display_name: string }[]).map((p) => [
      p.id,
      p.display_name,
    ]),
  );

  const pending = new Map<string, number>();
  for (const row of (commitmentResult.data ?? []) as { profile_id: string }[]) {
    pending.set(row.profile_id, (pending.get(row.profile_id) ?? 0) + 1);
  }

  const standings: Standing[] = [...names.entries()].map(([id, displayName]) => {
    const his = days.filter((d) => d.profileId === id);
    // `days` is ordered newest first by the server, so the first is the most recent.
    const lastReported = his[0]?.localDate ?? null;
    return {
      profileId: id,
      displayName,
      lastReported,
      daysSilent: daysSilent(lastReported, today),
      daysHeld: his.filter((d) => d.finalStatus === 'complete').length,
      daysReset: his.filter((d) => d.finalStatus === 'reset').length,
      commitmentsPending: pending.get(id) ?? 0,
    };
  });

  const directives = (
    (directiveResult.data ?? []) as {
      id: string;
      author_id: string;
      subject_id: string;
      week_start: string;
      body: string;
    }[]
  ).map(
    (r): Directive => ({
      id: r.id,
      authorId: r.author_id,
      subjectId: r.subject_id,
      weekStart: r.week_start,
      body: r.body,
    }),
  );

  return {
    mine: days.filter((d) => d.profileId === profileId),
    circle: days,
    standings,
    directives,
  };
}

export function useCommandData(profileId: string, timezone: string): CommandData {
  const [loaded, setLoaded] = useState<CommandLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // His date, in his zone. Never from the browser's clock — §3.1.
  const localDate = getLocalDateString(timezone);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!profileId) return;
    let live = true;

    loadCommand(profileId, localDate)
      .then((next) => {
        if (live) {
          setLoaded(next);
          setError(null);
        }
      })
      .catch((cause: Error) => {
        if (live) setError(cause.message);
      });

    return () => {
      live = false;
    };
  }, [profileId, localDate, nonce]);

  return { loaded, error, localDate, reload };
}
