import { getSupabase } from '@/lib/supabase';
import { OfflineError } from '@/lib/sqlstate';
import type { SitrepPayload } from '@/features/forge/sitrep-draft';

/**
 * Sending a filed day to the server.
 *
 * One RPC, `public.file_sitrep`, because a reset is four writes that must not half-apply — see
 * the header of supabase/migrations/0004_file_sitrep.sql. It is idempotent, which is what makes
 * it safe for the outbox to retry.
 */

export interface SitrepWriteResult {
  sitrepId: string;
  /** Set when the day was a reset: the enrollment that now carries Day 1. */
  nextEnrollmentId: string | null;
}

export async function sendSitrep(payload: SitrepPayload): Promise<SitrepWriteResult> {
  const { data, error } = await getSupabase().rpc('file_sitrep', {
    p_enrollment_id: payload.enrollmentId,
    p_local_date: payload.localDate,
    p_final_status: payload.finalStatus,
    p_results: payload.results.map((result) => ({
      protocol_id: result.protocolId,
      status: result.status,
      med_option_id: result.medOptionId,
    })),
    p_reset_kind: payload.resetKind,
    p_protocols_failed: payload.protocolsFailed,
  });

  if (error) {
    // A PostgREST error carries a SQLSTATE and is thrown unchanged — the queue classifies it. An
    // error with no SQLSTATE means no Postgres error came back at all; if the device is offline we
    // know why, and saying so keeps a genuine outage from spending the bounded `unknown` budget.
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }

  const result = (data ?? {}) as { sitrep_id?: string; next_enrollment_id?: string | null };
  return {
    sitrepId: result.sitrep_id ?? '',
    nextEnrollmentId: result.next_enrollment_id ?? null,
  };
}

/**
 * What to tell a man whose report was refused.
 *
 * Every message here corresponds to a named exception in 0004_file_sitrep.sql, matched on the
 * exception's own text — which is a stable identifier we chose, not a database vendor's prose.
 * The fallback quotes the server rather than inventing a reason: "something went wrong" is how a
 * report gets silently abandoned.
 */
export function refusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('sitrep_enrollment_not_yours')) {
    return 'That day belongs to another member. Nothing was written.';
  }
  if (message.includes('sitrep_reset_is_final')) {
    return 'A reset is already recorded for that day and the campaign has moved on. It cannot be amended.';
  }
  if (message.includes('sitrep_reset_not_latest')) {
    return 'You have already filed a later day, so this one cannot become a reset.';
  }
  if (message.includes('sitrep_enrollment_closed')) {
    return 'That enrollment has ended. Its history is intact — file against the current one.';
  }
  if (message.includes('sitrep_in_future')) {
    return 'You cannot file a report for a day you have not lived yet.';
  }
  if (message.includes('sitrep_before_enrollment')) {
    return 'That day belongs to an earlier enrollment. Its history is still there.';
  }
  if (message.includes('protocol_results_med_option_only_for_med_pass')) {
    return 'A full pass cannot also name a MED option. Reopen the day and answer it again.';
  }
  return `The server refused it: ${message}`;
}
