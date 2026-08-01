import { getSupabase } from '@/lib/supabase';

/**
 * Writing and withdrawing a directive.
 *
 * Two verbs, and no third. There is deliberately no `editDirective`: the table grants no UPDATE
 * at all, so an amendment is a withdrawal followed by a new one — which shows up in `created_at`
 * where an in-place edit would not. A directive quietly reworded after the man has read it means
 * the two of them remember different instructions and only one of them can check.
 *
 * Not routed through the outbox. A mentor writes one while looking at the screen, and a queued
 * directive that lands next Tuesday is an instruction about a week that has finished.
 */

export const DIRECTIVE_CAP = 140;

export interface DirectivePayload {
  authorId: string;
  subjectId: string;
  weekStart: string;
  body: string;
}

export async function sendDirective(payload: DirectivePayload): Promise<void> {
  const { error } = await getSupabase().from('mentor_directives').insert({
    author_id: payload.authorId,
    subject_id: payload.subjectId,
    week_start: payload.weekStart,
    body: payload.body.trim(),
  });
  if (error) throw error;
}

export async function withdrawDirective(id: string): Promise<void> {
  const { error } = await getSupabase().from('mentor_directives').delete().eq('id', id);
  if (error) throw error;
}

/**
 * What to tell a mentor whose directive was refused.
 *
 * Matched on the constraint names in 0010_directives.sql — identifiers this repository chose,
 * not a vendor's prose.
 */
export function directiveRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('directives_one_per_subject_week')) {
    return 'You have already written to him this week. Withdraw that one first — this is not a feed.';
  }
  if (message.includes('directives_not_self')) {
    return 'A directive goes to another man.';
  }
  if (message.includes('directives_body_not_blank')) {
    return 'Say the instruction.';
  }
  if (message.includes('capped_text_140')) {
    return 'Keep it under 140 characters. An instruction that needs a paragraph is not one yet.';
  }
  if (message.includes('row-level security')) {
    return 'Only the mentor of this circle can write a directive.';
  }
  return `The server refused it: ${message}`;
}
