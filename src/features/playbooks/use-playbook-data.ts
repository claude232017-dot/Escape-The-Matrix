import { useCallback, useEffect, useState } from 'react';
import { getLocalDateString } from '@/lib/date';
import { getSupabase } from '@/lib/supabase';
import type { Application, Playbook, Transfer } from '@/features/playbooks/transfer';

/**
 * Everything the Playbooks screen reads.
 *
 * Three queries, and the split between them is the feature's whole privacy design rather than a
 * performance decision:
 *
 *   * `playbooks` — circle-readable, the catalogue everyone sees.
 *   * `playbook_applications` — his own only (plus the mentor's view of everyone). RLS decides;
 *     nothing here filters, because a filter in TypeScript is decoration (§3.3).
 *   * `playbook_transfer()` — counts with no names, from a SECURITY DEFINER function, so a man
 *     can see that a system failed for four others without learning which four.
 *
 * The third exists *because* the second is restricted. If applications were circle-readable the
 * counts could be computed client-side and the function would be redundant — and the enrollment
 * disclosure would need re-consenting.
 */

export interface PlaybookLoaded {
  playbooks: Playbook[];
  /** The order the server returned them in, oldest first — see `catalogue`. */
  order: string[];
  mine: Application[];
  transfer: Map<string, Transfer>;
}

export interface PlaybookData {
  loaded: PlaybookLoaded | null;
  error: string | null;
  localDate: string;
  reload: () => void;
}

/**
 * Read the catalogue, his applications, and the counts.
 *
 * Exported so `tests/api` can drive it against a real PostgREST — the same reason `loadForge`,
 * `loadWeek` and `loadCommand` are.
 */
export async function loadPlaybooks(): Promise<PlaybookLoaded> {
  const supabase = getSupabase();

  const [catalogueResult, mineResult, transferResult] = await Promise.all([
    supabase
      .from('playbooks')
      .select('id, title, body, protocol_id, is_active, promoted_from')
      .order('created_at', { ascending: true }),
    supabase.from('playbook_applications').select('id, playbook_id, outcome, adopted_on'),
    supabase.rpc('playbook_transfer'),
  ]);

  if (catalogueResult.error) throw new Error(catalogueResult.error.message);
  if (mineResult.error) throw new Error(mineResult.error.message);
  if (transferResult.error) throw new Error(transferResult.error.message);

  const playbooks = (
    (catalogueResult.data ?? []) as {
      id: string;
      title: string;
      body: string;
      protocol_id: string | null;
      is_active: boolean;
      promoted_from: string | null;
    }[]
  ).map(
    (r): Playbook => ({
      id: r.id,
      title: r.title,
      body: r.body,
      protocolId: r.protocol_id,
      isActive: r.is_active,
      promotedFrom: r.promoted_from,
    }),
  );

  const mine = (
    (mineResult.data ?? []) as {
      id: string;
      playbook_id: string;
      outcome: Application['outcome'];
      adopted_on: string;
    }[]
  ).map(
    (r): Application => ({
      id: r.id,
      playbookId: r.playbook_id,
      outcome: r.outcome,
      adoptedOn: r.adopted_on,
    }),
  );

  const transfer = new Map(
    (
      (transferResult.data ?? []) as {
        playbook_id: string;
        adopted: number;
        held: number;
        did_not: number;
        pending: number;
      }[]
    ).map((r) => [
      r.playbook_id,
      {
        playbookId: r.playbook_id,
        adopted: r.adopted,
        held: r.held,
        didNot: r.did_not,
        pending: r.pending,
      },
    ]),
  );

  return { playbooks, order: playbooks.map((p) => p.id), mine, transfer };
}

export function usePlaybookData(profileId: string, timezone: string): PlaybookData {
  const [loaded, setLoaded] = useState<PlaybookLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // His date, in his zone. Never from the browser's clock — §3.1.
  const localDate = getLocalDateString(timezone);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!profileId) return;
    let live = true;

    loadPlaybooks()
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
  }, [profileId, nonce]);

  return { loaded, error, localDate, reload };
}
