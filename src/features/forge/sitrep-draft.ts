import {
  activeProtocols,
  evaluateDay,
  type DayEvaluation,
  type ProtocolResult,
  type ProtocolStatus,
  type ResetKind,
  type Ruleset,
} from '@/features/forge/doctrine';

/**
 * The in-progress SITREP, as a value.
 *
 * Pure and separate from the screen so the rules below can be tested without a browser. Two of
 * them exist to keep the filing under sixty seconds one-handed, and one mirrors a database
 * constraint — those are not presentation concerns.
 */

export interface ProtocolWithMed {
  id: string;
  slug: string;
  label: string;
  nickname: string | null;
  kind: 'duty' | 'prohibition';
  activatesOnDay: number;
  isTreasonTrigger: boolean;
  /**
   * Whether peers see this protocol itemised or only its contribution to the day's status.
   *
   * Carried into the UI so the row can say so where he answers it. §3.5 requires the
   * aggregate-only default for sensitive protocols; telling him at the point of entry is the
   * difference between a policy and a disclosure.
   */
  visibility: 'itemised' | 'aggregate_only';
  medOptions: { id: string; label: string; body: string }[];
}

export interface DraftEntry {
  status: ProtocolStatus | null;
  /** Which MED alternative he took. Only ever set alongside `med_pass`. */
  medOptionId: string | null;
}

export type SitrepDraft = Record<string, DraftEntry>;

export function emptyDraft(): SitrepDraft {
  return {};
}

/**
 * Whether this protocol has a minimum effective dose at all.
 *
 * Prohibitions mostly do not: there is no reduced version of not playing video games, and
 * offering one would turn a binary into a negotiation. Duties do, and the MED is the mechanic
 * the whole doctrine rests on — so the control has three positions for some rows and two for
 * others, decided by the data rather than by the protocol's kind.
 */
export function offersMed(protocol: ProtocolWithMed): boolean {
  return protocol.medOptions.length > 0;
}

/**
 * Record a status.
 *
 * Two rules here, both load-bearing:
 *
 *  1. **Choosing `med_pass` on a protocol with exactly one option selects it automatically.** Most
 *     protocols have one MED, and making him tap it separately would add a tap per protocol to
 *     every single day — which is most of the sixty-second budget spent on a choice that has one
 *     answer.
 *  2. **Moving away from `med_pass` clears the option.** Mirror note: the SQL constraint
 *     `protocol_results_med_option_only_for_med_pass` in supabase/migrations/0003_forge.sql
 *     rejects a `med_option_id` on a pass or a fail, so leaving it set would make the write
 *     bounce — and it would claim he did the minimum on a day he did the whole thing.
 */
export function setStatus(
  draft: SitrepDraft,
  protocol: ProtocolWithMed,
  status: ProtocolStatus,
): SitrepDraft {
  const medOptionId =
    status === 'med_pass'
      ? (draft[protocol.slug]?.medOptionId ??
        (protocol.medOptions.length === 1 ? (protocol.medOptions[0]?.id ?? null) : null))
      : null;
  return { ...draft, [protocol.slug]: { status, medOptionId } };
}

/**
 * Choose a MED alternative.
 *
 * Also sets the status to `med_pass`: picking "Option B — a 20-minute walk" *is* saying he did the
 * minimum, and requiring a separate tap to confirm what he just said is friction for its own sake.
 */
export function setMedOption(draft: SitrepDraft, slug: string, optionId: string): SitrepDraft {
  return { ...draft, [slug]: { status: 'med_pass', medOptionId: optionId } };
}

/** Protocols still awaiting an answer on this day. */
export function unanswered(
  draft: SitrepDraft,
  protocols: readonly ProtocolWithMed[],
  day: number,
): ProtocolWithMed[] {
  return activeProtocols(protocols, day).filter((protocol) => {
    const entry = draft[protocol.slug];
    if (!entry?.status) return true;
    // A MED pass on a protocol offering a genuine choice is not an answer until he has said
    // which one — otherwise "either/or" is recorded as neither.
    if (entry.status === 'med_pass' && protocol.medOptions.length > 1 && !entry.medOptionId) {
      return true;
    }
    return false;
  });
}

export function isComplete(
  draft: SitrepDraft,
  protocols: readonly ProtocolWithMed[],
  day: number,
): boolean {
  return unanswered(draft, protocols, day).length === 0;
}

/** The results, for the doctrine evaluator. Inactive protocols are excluded, not defaulted. */
export function toResults(
  draft: SitrepDraft,
  protocols: readonly ProtocolWithMed[],
  day: number,
): ProtocolResult[] {
  return activeProtocols(protocols, day).flatMap((protocol) => {
    const status = draft[protocol.slug]?.status;
    return status ? [{ slug: protocol.slug, status }] : [];
  });
}

/**
 * What this draft currently amounts to.
 *
 * The screen shows this live, so a man knows what today will be recorded as *before* he files
 * it. Delegated to `evaluateDay` rather than reimplemented: two places deciding what a reset is
 * would eventually be two answers.
 */
export function evaluateDraft(input: {
  draft: SitrepDraft;
  protocols: readonly ProtocolWithMed[];
  day: number;
  ruleset?: Ruleset;
}): DayEvaluation {
  return evaluateDay({
    day: input.day,
    protocols: input.protocols,
    results: toResults(input.draft, input.protocols, input.day),
    ...(input.ruleset ? { ruleset: input.ruleset } : {}),
  });
}

export interface SitrepPayload {
  enrollmentId: string;
  localDate: string;
  finalStatus: 'complete' | 'repeat' | 'reset';
  /** Set only when `finalStatus` is 'reset'. Mirrors `reset_events.kind`. */
  resetKind: ResetKind | null;
  /** The slugs that failed, so a reset event stands alone in later analysis. */
  protocolsFailed: string[];
  results: { protocolId: string; status: ProtocolStatus; medOptionId: string | null }[];
}

/**
 * The write, shaped for the outbox and for `public.file_sitrep`.
 *
 * Returns **null** for an incomplete day rather than filing a partial one. The status is derived
 * here from `evaluateDay` and is never accepted from a caller: a screen that could name its own
 * `final_status` is a screen that can disagree with the doctrine, and the disagreement would be
 * invisible because both sides would look reasonable.
 */
export function toPayload(input: {
  enrollmentId: string;
  localDate: string;
  draft: SitrepDraft;
  protocols: readonly ProtocolWithMed[];
  day: number;
  ruleset?: Ruleset;
}): SitrepPayload | null {
  const evaluation = evaluateDraft(input);
  if (evaluation.kind === 'incomplete') return null;

  return {
    enrollmentId: input.enrollmentId,
    localDate: input.localDate,
    finalStatus: evaluation.outcome,
    resetKind: evaluation.resetKind,
    protocolsFailed: evaluation.failed,
    results: activeProtocols(input.protocols, input.day).flatMap((protocol) => {
      const entry = input.draft[protocol.slug];
      if (!entry?.status) return [];
      return [{ protocolId: protocol.id, status: entry.status, medOptionId: entry.medOptionId }];
    }),
  };
}

/**
 * The outbox coalescing key.
 *
 * One slot per enrollment per day, matching the unique index `sitreps_one_per_day`. Ten edits to
 * one day must produce one queued upsert, and the key is what makes that true.
 */
export function draftKey(enrollmentId: string, localDate: string): string {
  return `sitrep:${enrollmentId}:${localDate}`;
}

/**
 * Substitute the member's own artefacts into MED text.
 *
 * The Morning Protocol MED says "read the Top G Code aloud". Showing that instruction without the
 * Code is friction at exactly the wrong moment — the low-energy morning it exists to rescue. So
 * the Code is rendered beside it; this function reports what a given MED needs so the screen knows
 * what to show.
 */
export function medReferences(body: string): {
  topGCode: boolean;
  commandPost: boolean;
  fortressProtocol: boolean;
} {
  const text = body.toLowerCase();
  return {
    topGCode: text.includes('top g code'),
    commandPost: text.includes('command post'),
    fortressProtocol: text.includes('fortress protocol'),
  };
}
