import { getSupabase } from '@/lib/supabase';
import { OfflineError } from '@/lib/sqlstate';

import type { BusinessDayPayload, MoneyPayload } from '@/features/ledger/ledger-draft';

/**
 * Sending the Ledger's writes.
 *
 * Two shapes, two reasons. The day's counts go through `public.file_business_day`, one call for
 * one venture-day, idempotent so the outbox may retry it (ADR-012). A money entry is a single row
 * with a **client-generated id**, upserted on that id — which is what makes a retry after an
 * ambiguous failure land on the same row instead of booking the payment twice.
 */

export interface VenturePayload {
  ownerId: string;
  name: string;
  /** Free-ish but capped — `public.capped_text_140`. Null when he did not say. */
  kind: string | null;
  startedOn: string;
}

/**
 * Name a venture.
 *
 * A plain insert; the RLS policy `ventures_write_self` is the whole rule.
 *
 * This lived inline in the NewVenture component until it became the write that proved the
 * suite could not see a whole class of failure: `kind` is a `capped_text_140` column, PostgREST
 * emits a schema-qualified cast for it, and while that domain lived in `app` — which
 * `authenticated` cannot reach (ADR-011) — the statement was rejected before RLS was consulted.
 * Every test was green because none of them went through PostgREST.
 *
 * It is here now for the same reason every other write is: so `tests/api` can call it against a
 * real server. Data access in a component is data access no test can reach.
 */
export async function sendVenture(payload: VenturePayload): Promise<void> {
  const { error } = await getSupabase().from('ventures').insert({
    owner_id: payload.ownerId,
    name: payload.name,
    kind: payload.kind,
    started_on: payload.startedOn,
  });
  if (error) throw error;
}

export async function sendBusinessDay(payload: BusinessDayPayload): Promise<{ written: number }> {
  const { data, error } = await getSupabase().rpc('file_business_day', {
    p_venture_id: payload.ventureId,
    p_local_date: payload.localDate,
    p_counts: payload.counts.map((entry) => ({
      action_id: entry.actionId,
      count: entry.count,
    })),
  });

  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
  return { written: ((data ?? {}) as { written?: number }).written ?? 0 };
}

/**
 * Book one money entry.
 *
 * A plain upsert rather than an RPC: it is a single row, so there is no multi-write atomicity to
 * protect, and the RLS policy on `money_entries` is the whole rule. The one thing that needs care
 * is idempotency, and the client-generated primary key supplies it.
 */
export async function sendMoneyEntry(payload: MoneyPayload): Promise<void> {
  const { error } = await getSupabase().from('money_entries').upsert(
    {
      id: payload.id,
      venture_id: payload.ventureId,
      occurred_on: payload.occurredOn,
      direction: payload.direction,
      // A string on the wire, parsed straight into bigint by Postgres. Never a JS number — see
      // toMoneyPayload() in ledger-draft.ts.
      amount_minor: payload.amountMinor,
      currency: payload.currency,
      category: payload.category,
      is_recurring: payload.isRecurring,
      note: payload.note,
    },
    { onConflict: 'id' },
  );

  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
}

/**
 * What to tell a man whose Ledger write was refused.
 *
 * Matched on the named exceptions and constraints in 0006_ledger.sql — identifiers this
 * repository chose, not a vendor's prose.
 */
export function ledgerRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('business_venture_not_yours') || message.includes('money_venture_not_yours')) {
    return 'That venture belongs to another member. Nothing was written.';
  }
  if (message.includes('business_entry_in_future') || message.includes('money_in_future')) {
    return 'You cannot record work or money for a day you have not lived yet.';
  }
  if (message.includes('money_entries_amount_positive')) {
    return 'An amount has to be more than zero. Use the direction to say which way it went.';
  }
  if (message.includes('daily_business_entries_count_sane')) {
    return 'That count is out of range. The most a single action accepts in a day is 1000.';
  }
  if (message.includes('currency_code_format')) {
    return 'That is not a currency code this app recognises.';
  }
  if (message.includes('business_actions_ceiling')) {
    return 'Seven active actions is the ceiling. Retire one before adding another.';
  }
  return `The server refused it: ${message}`;
}
