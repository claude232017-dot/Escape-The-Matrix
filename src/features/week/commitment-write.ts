import { getSupabase } from '@/lib/supabase';
import { OfflineError } from '@/lib/sqlstate';
import type { CommitmentOutcome, DeclarePayload } from '@/features/week/commitment-draft';

/**
 * Sending the week's writes.
 *
 * Two shapes, for the same reasons as the Ledger's two. The slate goes through
 * `public.declare_commitments` — one call for one member-week, so three commitments cannot land
 * as two, and idempotent so the outbox may retry it. Settling is a single-row update, where the
 * row's own identity makes a retry safe without any help.
 */

export async function sendCommitments(payload: DeclarePayload): Promise<{ written: number }> {
  const { data, error } = await getSupabase().rpc('declare_commitments', {
    p_week_start: payload.weekStart,
    p_bodies: payload.bodies,
  });

  if (error) {
    // Mirror: the same classification as sendBusinessDay. A PostgREST error with no SQLSTATE
    // while the browser reports itself offline is a transport failure, not a refusal — and the
    // difference decides whether the outbox retries or gives up. Never matched on message text
    // (§3.10).
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
  return { written: ((data ?? {}) as { written?: number }).written ?? 0 };
}

export interface SettlePayload {
  id: string;
  outcome: Exclude<CommitmentOutcome, 'pending'>;
}

/**
 * Answer one commitment.
 *
 * A plain update rather than an RPC: it is one row, addressed by its own primary key, so a
 * retry lands on the same row and says the same thing. The window rule — Sunday or later — is
 * `app.enforce_commitment_windows()`, and nothing here duplicates it beyond the button being
 * hidden, because a rule enforced only in the browser is decoration (§3.3).
 */
export async function sendSettlement(payload: SettlePayload): Promise<void> {
  const { error } = await getSupabase()
    .from('commitments')
    .update({ outcome: payload.outcome })
    .eq('id', payload.id);

  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
}

/**
 * Take back a commitment declared today.
 *
 * Legal only on the day it was declared, and only while pending — policy
 * `commitments_delete_same_day`. Not routed through the outbox, and the reason is worth
 * stating: a queued withdrawal that flushed tomorrow would be refused by that policy, so the
 * man would have watched it leave the screen and then found it back the next morning. Better to
 * fail now, in front of him, than to promise something the database will not honour.
 */
export async function withdrawCommitment(id: string): Promise<void> {
  const { error } = await getSupabase().from('commitments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * What to tell a man whose write was refused.
 *
 * Matched on the named exceptions in 0008_commitments.sql — identifiers this repository chose,
 * not a vendor's prose. Every one of these is a rule he could plausibly hit, so every one gets a
 * sentence that says what happened rather than what failed.
 */
export function commitmentRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('commitments_ceiling')) {
    return 'Three commitments in a week is the cap. It is a cap, not a target.';
  }
  if (message.includes('commitment_immutable')) {
    return 'A commitment cannot be reworded once it is declared. That is the mechanism.';
  }
  if (message.includes('commitment_too_early')) {
    return 'Settle on Sunday. The week is not over yet.';
  }
  if (message.includes('commitment_already_settled')) {
    return 'You can correct an answer, but not take it back to unanswered.';
  }
  if (message.includes('commitment_not_this_week')) {
    return 'Commitments are declared for the week you are in.';
  }
  if (message.includes('commitments_body_not_blank')) {
    return 'A blank commitment is not a commitment.';
  }
  if (message.includes('capped_text_140')) {
    return 'Keep it under 140 characters. Say the specific thing.';
  }
  return `The server refused it: ${message}`;
}
