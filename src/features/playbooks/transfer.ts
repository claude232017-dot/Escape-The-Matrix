/**
 * Whether a system travels.
 *
 * The one thing a circle produces that a man alone cannot. Everything else in this app is a
 * fact about one person; this is the only place where twelve men's data answers a question none
 * of them could answer individually.
 *
 * The discipline is the same as the correlation engine's, and for the same reason: a verdict
 * from two adoptions is not a verdict, and a man who acts on one, finds nothing, and learns the
 * app makes things up will never trust the real finding later.
 */

/** Mirrors `public.application_outcome` in 0011_playbooks.sql. */
export const OUTCOMES = ['pending', 'held', 'did_not'] as const;
export type ApplicationOutcome = (typeof OUTCOMES)[number];

export interface Playbook {
  id: string;
  title: string;
  body: string;
  protocolId: string | null;
  isActive: boolean;
  /** Null when the mentor wrote it rather than promoting a filed insight. */
  promotedFrom: string | null;
}

/** Counts only. Mirrors `public.playbook_transfer()`, which returns no names by design. */
export interface Transfer {
  playbookId: string;
  adopted: number;
  held: number;
  didNot: number;
  pending: number;
}

/** His own adoption of one, if he has one. */
export interface Application {
  id: string;
  playbookId: string;
  outcome: ApplicationOutcome;
  adoptedOn: string;
}

/**
 * Answers required before a verdict is offered.
 *
 * Three, not five. Lower than `COMPARISON_MINIMUM` in the correlation engine because the unit
 * is different: there, five *days* out of thirty is a small slice of one man; here, three *men*
 * out of twelve is a quarter of the circle having tried the same thing, which in a group this
 * size is as much evidence as this feature will ever get.
 *
 * Stated as a number rather than a percentage so a man can check it by counting.
 */
export const TRANSFER_MINIMUM = 3;

export type Verdict =
  /** Held for most who tried it. */
  | 'travels'
  /** Did not hold for most who tried it — a finding, and the more useful one. */
  | 'personal'
  /** Split down the middle with enough answers to say so. */
  | 'mixed'
  /** Not enough answers yet. The correct answer for most of a campaign. */
  | 'untested';

/**
 * What the counts are allowed to claim.
 *
 * `pending` adoptions are excluded from the denominator: a man who adopted a system yesterday
 * and has not answered yet is not evidence either way, and counting him as a failure would make
 * every new playbook look worse the more people were currently trying it.
 */
export function verdict(t: Transfer): Verdict {
  const answered = t.held + t.didNot;
  if (answered < TRANSFER_MINIMUM) return 'untested';
  if (t.held > t.didNot) return 'travels';
  if (t.didNot > t.held) return 'personal';
  return 'mixed';
}

/** How many answered, for a screen that has to show its working. */
export function answered(t: Transfer): number {
  return t.held + t.didNot;
}

/**
 * The catalogue, in the order it should be read.
 *
 * **Not** by adoption count, and not by verdict. Ordering by popularity is the leaderboard §1
 * rules out, and ordering by verdict quietly buries the systems that did not travel — which are
 * the ones carrying the most information.
 *
 * Active first, then oldest first: a playbook promoted in week one has had longer to gather
 * evidence, and reading them in the order the circle met them is the only ordering that is not
 * a judgement about them.
 */
export function catalogue(
  playbooks: readonly Playbook[],
  order: readonly string[] = [],
): Playbook[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...playbooks].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  });
}

/**
 * Whether he may adopt this one.
 *
 * One application per man per playbook, so an existing one — settled or not — closes the door.
 * Mirror: `applications_one_per_man` in 0011_playbooks.sql, which is what makes it true.
 */
export function canAdopt(playbook: Playbook, mine: readonly Application[]): boolean {
  if (!playbook.isActive) return false;
  return !mine.some((a) => a.playbookId === playbook.id);
}

/** Whether he still owes an answer on this one. */
export function owesAnswer(mine: readonly Application[], playbookId: string): boolean {
  return mine.some((a) => a.playbookId === playbookId && a.outcome === 'pending');
}

/** One outbox slot per application, so answering three does not coalesce into answering one. */
export function applicationKey(playbookId: string): string {
  return `playbook:${playbookId}`;
}
