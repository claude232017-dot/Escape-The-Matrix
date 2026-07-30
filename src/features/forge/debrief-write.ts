import { getSupabase } from '@/lib/supabase';
import { OfflineError } from '@/lib/sqlstate';

import type { DebriefPayload } from '@/features/forge/debrief-draft';

/**
 * Sending a debrief.
 *
 * One RPC for both halves, for the same reasons as the SITREP (ADR-012): the insight and the
 * tactic must not half-apply, and the outbox retries.
 */

export async function sendDebrief(payload: DebriefPayload): Promise<{ debriefId: string }> {
  const { data, error } = await getSupabase().rpc('file_debrief', {
    p_sitrep_id: payload.sitrepId,
    p_attacked: payload.attacked,
    p_system_used: payload.systemUsed,
    p_victory: payload.victory,
    p_insight_protocol_id: payload.insightProtocolId,
    p_outcome: payload.outcome,
    p_occurred_at_hour: payload.occurredAtHour,
    p_trigger_kind: payload.triggerKind,
    p_propaganda: payload.propaganda,
    p_attacked_protocol_id: payload.attackedProtocolId,
  });

  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }

  const result = (data ?? {}) as { debrief_id?: string };
  return { debriefId: result.debrief_id ?? '' };
}

/**
 * What to tell a man whose debrief was refused.
 *
 * Matched on the named exceptions and constraints in 0005_debrief.sql — identifiers this
 * repository chose, not a vendor's prose. The fallback quotes the server rather than inventing a
 * reason.
 */
export function debriefRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('debrief_sitrep_not_yours')) {
    return 'That day belongs to another member. Nothing was written.';
  }
  if (message.includes('tactic_without_attack')) {
    return 'The two halves disagreed about whether you were attacked. Answer that question again.';
  }
  if (message.includes('debriefs_insight_paired')) {
    return 'An insight needs both the system and what it won you.';
  }
  if (message.includes('debriefs_outcome_iff_attacked')) {
    return 'An attack needs an outcome, and a quiet day cannot have one.';
  }
  if (message.includes('bottom_g_tactics_hour_range')) {
    return 'That hour is not a time of day.';
  }
  if (message.includes('capped_text_140')) {
    return 'One of those fields is over 140 characters.';
  }
  return `The server refused it: ${message}`;
}
