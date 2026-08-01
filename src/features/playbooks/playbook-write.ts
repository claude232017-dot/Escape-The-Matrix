import { getSupabase } from '@/lib/supabase';
import { OfflineError } from '@/lib/sqlstate';
import type { ApplicationOutcome } from '@/features/playbooks/transfer';

/**
 * Adopting a system, answering for it, and promoting one.
 *
 * Note what is not here: no `editPlaybook`, because the text is immutable once men are working
 * from it — only `is_active` is granted for update (0011). And no `unadopt` for a settled
 * application, because deleting an answered one is how a man removes the evidence that
 * something did not work for him.
 */

export interface AdoptPayload {
  playbookId: string;
  profileId: string;
  adoptedOn: string;
}

export async function adoptPlaybook(payload: AdoptPayload): Promise<void> {
  const { error } = await getSupabase().from('playbook_applications').insert({
    playbook_id: payload.playbookId,
    profile_id: payload.profileId,
    adopted_on: payload.adoptedOn,
  });
  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
}

export interface AnswerPayload {
  applicationId: string;
  outcome: Exclude<ApplicationOutcome, 'pending'>;
}

export async function answerApplication(payload: AnswerPayload): Promise<void> {
  const { error } = await getSupabase()
    .from('playbook_applications')
    .update({ outcome: payload.outcome })
    .eq('id', payload.applicationId);
  if (error) {
    if (!error.code && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new OfflineError(error);
    }
    throw error;
  }
}

/** Abandoning one he has not answered for. The policy refuses a settled one. */
export async function abandonApplication(applicationId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('playbook_applications')
    .delete()
    .eq('id', applicationId);
  if (error) throw error;
}

export interface PromotePayload {
  circleId: string;
  promotedBy: string;
  /** The debrief this came from, when it came from one. */
  promotedFrom: string | null;
  title: string;
  body: string;
}

/** Mentor only — `playbooks_write_mentor` is the rule; this just sends. */
export async function promotePlaybook(payload: PromotePayload): Promise<void> {
  const { error } = await getSupabase().from('playbooks').insert({
    circle_id: payload.circleId,
    promoted_by: payload.promotedBy,
    promoted_from: payload.promotedFrom,
    title: payload.title.trim(),
    body: payload.body.trim(),
  });
  if (error) throw error;
}

export async function retirePlaybook(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('playbooks')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

/**
 * What to tell a man whose write was refused.
 *
 * Matched on the constraint names in 0011_playbooks.sql — identifiers this repository chose,
 * not a vendor's prose.
 */
export function playbookRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('applications_one_per_man')) {
    return 'You have already tried this one. A second go would move its record without adding to it.';
  }
  if (message.includes('application_already_answered')) {
    return 'You can correct the answer, not take it back to unanswered.';
  }
  if (message.includes('application_immutable')) {
    return 'That application belongs to a different playbook.';
  }
  if (message.includes('playbooks_one_per_source')) {
    return 'That insight is already a playbook.';
  }
  if (message.includes('playbooks_title_not_blank') || message.includes('playbooks_body_not_blank')) {
    return 'A playbook needs a name and the system itself.';
  }
  if (message.includes('capped_text_140')) {
    return 'Keep it under 140 characters. A system that needs a paragraph has not been understood yet.';
  }
  if (message.includes('row-level security')) {
    return 'Only the mentor of this circle can promote a playbook.';
  }
  return `The server refused it: ${message}`;
}
