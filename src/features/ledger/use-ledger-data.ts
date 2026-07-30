import { useCallback, useEffect, useState } from 'react';
import { getLocalDateString } from '@/lib/date';
import { fromRow } from '@/lib/money';
import { getSupabase } from '@/lib/supabase';
import {
  currencyOf,
  type BusinessAction,
  type CountDraft,
  type MoneyCategory,
  type MoneyEntry,
  type Venture,
} from '@/features/ledger/ledger-draft';

/**
 * Everything the Ledger reads, loaded once.
 *
 * Same shape as @/features/forge/use-forge-data, for the same reason: a screen rendered inside a
 * tab panel gets unmounted when the tab changes, so a screen that owns its own load re-runs the
 * whole thing on every switch. The data belongs to the session.
 */

export interface LedgerLoaded {
  ventures: Venture[];
  actions: BusinessAction[];
  /** Today's counts for each venture, keyed by venture id then action id. */
  today: Record<string, CountDraft>;
  money: MoneyEntry[];
  /** Rows dropped because this build does not recognise their currency. Reported, not hidden. */
  unreadableMoney: number;
}

export interface LedgerData {
  loaded: LedgerLoaded | null;
  error: string | null;
  localDate: string;
  reload: () => void;
}

async function loadLedger(profileId: string, localDate: string): Promise<LedgerLoaded> {
  const supabase = getSupabase();

  // Ventures and the action catalogue depend on nothing, so they go together.
  const [ventureResult, actionResult] = await Promise.all([
    supabase
      .from('ventures')
      .select('id, name, kind, status, started_on')
      .eq('owner_id', profileId)
      .order('started_on', { ascending: false }),
    supabase
      .from('business_actions')
      .select('id, slug, label, unit, hint, sort_order')
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  if (ventureResult.error) throw new Error(ventureResult.error.message);
  if (actionResult.error) throw new Error(actionResult.error.message);

  const ventures: Venture[] = ((ventureResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      id: row['id'] as string,
      name: row['name'] as string,
      kind: (row['kind'] as string | null) ?? null,
      status: row['status'] as Venture['status'],
      startedOn: row['started_on'] as string,
    }),
  );

  const actions: BusinessAction[] = ((actionResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      id: row['id'] as string,
      slug: row['slug'] as string,
      label: row['label'] as string,
      unit: row['unit'] as string,
      hint: (row['hint'] as string | null) ?? null,
      sortOrder: row['sort_order'] as number,
    }),
  );

  if (ventures.length === 0) {
    return { ventures, actions, today: {}, money: [], unreadableMoney: 0 };
  }

  const ventureIds = ventures.map((venture) => venture.id);
  const [entryResult, moneyResult] = await Promise.all([
    supabase
      .from('daily_business_entries')
      .select('venture_id, action_id, count')
      .eq('profile_id', profileId)
      .eq('local_date', localDate),
    supabase
      .from('money_entries')
      .select('id, venture_id, occurred_on, direction, amount_minor, currency, category, is_recurring, note')
      .in('venture_id', ventureIds)
      .order('occurred_on', { ascending: false })
      .limit(500),
  ]);

  const today: Record<string, CountDraft> = {};
  for (const row of (entryResult.data ?? []) as Record<string, unknown>[]) {
    const ventureId = row['venture_id'] as string;
    today[ventureId] = { ...today[ventureId], [row['action_id'] as string]: row['count'] as number };
  }

  let unreadableMoney = 0;
  const money: MoneyEntry[] = ((moneyResult.data ?? []) as Record<string, unknown>[]).flatMap(
    (row) => {
      // A row whose currency this build does not know is dropped and counted rather than
      // throwing: the database domain accepts any ISO-4217 shape, CURRENCY_EXPONENTS is a curated
      // list, and one unrecognised entry must not take the screen down.
      const currency = currencyOf(row['currency'] as string);
      if (!currency) {
        unreadableMoney += 1;
        return [];
      }
      return [
        {
          id: row['id'] as string,
          ventureId: row['venture_id'] as string,
          occurredOn: row['occurred_on'] as string,
          direction: row['direction'] as MoneyEntry['direction'],
          // fromRow parses the string Postgres sends for a bigint. Never Number() — that is the
          // one conversion §3.2 exists to forbid.
          amount: fromRow(row['amount_minor'] as string, currency),
          category: row['category'] as MoneyCategory,
          isRecurring: row['is_recurring'] as boolean,
          note: (row['note'] as string | null) ?? null,
        },
      ];
    },
  );

  return { ventures, actions, today, money, unreadableMoney };
}

export function useLedgerData(profileId: string, timezone: string): LedgerData {
  const localDate = getLocalDateString(timezone);

  const [loaded, setLoaded] = useState<LedgerLoaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  useEffect(() => {
    // Called before the profile resolves, because hooks cannot be conditional.
    if (!profileId) return;
    let cancelled = false;
    loadLedger(profileId, localDate)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not load the Ledger.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, localDate, token]);

  const reload = useCallback(() => {
    setError(null);
    setToken((value) => value + 1);
  }, []);

  return { loaded, error, localDate, reload };
}
