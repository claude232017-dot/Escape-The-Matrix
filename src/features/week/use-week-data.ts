import { useCallback, useEffect, useState } from 'react';
import { addDays, getLocalDateString } from '@/lib/date';
import { getSupabase } from '@/lib/supabase';
import {
  weekStartFor,
  type Commitment,
  type CommitmentOutcome,
  type WeekView,
} from '@/features/week/commitment-draft';

/**
 * Everything the week reads, loaded once by the shell.
 *
 * Same shape and the same reason as the Forge's and the Ledger's loaders: a screen inside a tab
 * panel is unmounted when the tab changes, so one that owns its own load re-runs the whole thing
 * on every switch.
 *
 * Two weeks are fetched, not one. On a Monday the interesting week is the one just gone — he has
 * commitments to settle from it — and on a Wednesday it is the current one. Fetching both means
 * the screen never has to go back to the server to answer "and how did last week end", and it is
 * one query either way.
 */

export interface CircleCommitment extends Commitment {
  profileId: string;
  displayName: string;
}

export interface WeekLoaded {
  /** His own current week. */
  current: WeekView;
  /** His own previous week, which is what he settles. */
  previous: WeekView;
  /** The circle's current week, him included — what the disclosure says the others can see. */
  circle: CircleCommitment[];
}

export interface WeekData {
  loaded: WeekLoaded | null;
  error: string | null;
  /** His today, resolved in his timezone. Never from the browser's clock. */
  localDate: string;
  weekStart: string;
  reload: () => void;
}

interface Row {
  id: string;
  profile_id: string;
  week_start: string;
  body: string;
  outcome: CommitmentOutcome;
  declared_on: string;
  profiles: { display_name: string } | null;
}

/**
 * Every read the week makes.
 *
 * Exported so `tests/api` can drive *this* against a real PostgREST rather than a re-typing of
 * it — the same reason `loadForge` is exported. The embed below is the shape that answered 400
 * on every Forge load for a week, so it is worth exercising rather than trusting.
 */
export async function loadWeek(profileId: string, today: string): Promise<WeekLoaded> {
  const thisMonday = weekStartFor(today);
  const lastMonday = addDays(thisMonday, -7);

  // One query for both weeks and the whole circle. The RLS policy is what decides which rows
  // come back — `app.shares_my_circle(profile_id)` — so this asks for everything it is allowed
  // to see rather than filtering by circle in the client, which would be decoration (§3.3).
  //
  // The embed on `profiles` resolves through commitments.profile_id → profiles.id. Guarded by
  // tests/db/embed-relationships.test.ts, which exists because an embed with no foreign key
  // behind it answers 400 and looks like it works.
  const { data, error } = await getSupabase()
    .from('commitments')
    .select('id, profile_id, week_start, body, outcome, declared_on, profiles!inner(display_name)')
    .in('week_start', [thisMonday, lastMonday])
    .order('declared_on');

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Row[];
  const mine = (weekStart: string): WeekView => ({
    weekStart,
    commitments: rows
      .filter((r) => r.profile_id === profileId && r.week_start === weekStart)
      .map(
        (r): Commitment => ({
          id: r.id,
          body: r.body,
          outcome: r.outcome,
          declaredOn: r.declared_on,
        }),
      ),
  });

  return {
    current: mine(thisMonday),
    previous: mine(lastMonday),
    circle: rows
      .filter((r) => r.week_start === thisMonday)
      .map(
        (r): CircleCommitment => ({
          id: r.id,
          body: r.body,
          outcome: r.outcome,
          declaredOn: r.declared_on,
          profileId: r.profile_id,
          // A row with no readable profile is a bug rather than a state to render around, but
          // rendering "—" beats throwing away the commitment.
          displayName: r.profiles?.display_name ?? '—',
        }),
      ),
  };
}

export function useWeekData(profileId: string, timezone: string): WeekData {
  const [loaded, setLoaded] = useState<WeekLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // His date, in his zone. Never `new Date().toISOString().slice(0, 10)` — §3.1.
  const localDate = getLocalDateString(timezone);
  const weekStart = weekStartFor(localDate);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    // Called before the profile resolves, because hooks cannot be conditional.
    if (!profileId) return;
    let live = true;

    // No `setError(null)` here. Clearing state synchronously in an effect body triggers a
    // cascading render, and the lint rule that catches it is worth obeying rather than
    // silencing: the error is cleared in the success callback below, which is the moment it
    // actually stops being true.
    loadWeek(profileId, localDate)
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

  return { loaded, error, localDate, weekStart, reload };
}
