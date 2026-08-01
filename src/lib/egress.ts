/**
 * The egress boundary.
 *
 * §3.5: *"Never send protocol detail to any third-party analytics, error reporter or log
 * aggregator. Scrub it at the boundary and test that you did."*
 *
 * ---------------------------------------------------------------------------
 * Why this exists before there is anything to send
 * ---------------------------------------------------------------------------
 * No reporter is wired up. Building the boundary anyway is the point: the note this replaces in
 * SECURITY.md §5 said the scrubbing "must land *with* the first reporter, not after it", and the
 * only way to guarantee that is for the door to already exist and be the only one. Adding Sentry
 * on a Friday afternoon is exactly when nobody writes a redaction layer.
 *
 * ---------------------------------------------------------------------------
 * It constructs a payload; it does not filter one
 * ---------------------------------------------------------------------------
 * This is the load-bearing decision. A redaction function that walks an object deleting
 * sensitive keys is a denylist, and a denylist is wrong the moment somebody adds a column —
 * which is every phase. `toReport` instead builds a fixed-shape object out of a handful of
 * named fields. **You cannot leak a field you never copy.**
 *
 * The consequence, stated plainly: a reporter wired through here gets a SQLSTATE, an error
 * class, and a route. It does not get the error's message unless that message is exactly one of
 * this repository's own identifiers, and it never gets a stack frame's arguments, a row, a
 * response body, or anything a member typed.
 *
 * ---------------------------------------------------------------------------
 * Why the message is dropped by default
 * ---------------------------------------------------------------------------
 * Because error messages carry data. A Postgres constraint violation arrives as
 *
 *     new row for relation "commitments" violates check constraint "commitments_body_not_blank"
 *
 * — harmless — but PostgREST also returns a `details` field reading `Failing row contains (…,
 * 'Ten sales calls', …)`, and a naive reporter sends the whole error object. So `details` and
 * `hint` are never copied at all, and `message` is reduced to a known identifier or dropped.
 *
 * The member's own console still gets everything. That is his device and his data, it is what
 * turns "it says the server gave no reason" into a diagnosis, and §3.5 is about third parties.
 */

/**
 * Identifiers this repository chose, which therefore contain no member data.
 *
 * Kept as an explicit list rather than a pattern, because a pattern that accepts
 * `[a-z_]+` would also accept `ten_sales_calls` — a commitment a man typed, in a message,
 * looking exactly like a constraint name.
 *
 * `tests/unit/egress.test.ts` checks this against the identifiers the migrations actually raise
 * and fails when they drift, so the list cannot quietly go stale.
 */
export const KNOWN_IDENTIFIERS: ReadonlySet<string> = new Set([
  // Sessions and permissions
  'commitment_no_session',
  'delete_no_session',
  'delete_no_account',
  'export_no_session',
  'review_no_session',
  'signup_requires_invitation',
  'profile_missing',
  // Windows and ordering
  'commitment_too_early',
  'commitment_not_this_week',
  'commitment_already_settled',
  'commitment_immutable',
  'application_already_answered',
  'application_immutable',
  'weekly_review_immutable',
  'review_too_early',
  'review_week_not_monday',
  'review_commitments_unresolved',
  'sitrep_enrollment_closed',
  'sitrep_reset_is_final',
  'campaign_not_found',
  'campaign_not_started',
  // Ceilings and shapes
  'commitments_ceiling',
  'business_actions_ceiling',
  'delete_confirmation_mismatch',
  'business_entry_in_future',
  'business_entry_venture_not_yours',
  'business_venture_not_yours',
  'money_venture_not_yours',
  'money_in_future',
  // Constraint names
  'applications_one_per_man',
  'playbooks_one_per_source',
  'directives_one_per_subject_week',
  'directives_not_self',
  'commitments_body_not_blank',
  'money_entries_amount_positive',
  'daily_business_entries_count_sane',
  'currency_code_format',
  'capped_text_140',
]);

/** Where the failure happened, as a shape rather than a URL. */
export type Route = 'app' | 'auth' | 'harness' | 'unknown';

/**
 * The whole payload, and nothing else is ever added to it without a reason in this comment.
 *
 * Every field is either a constant, a classification, or a name chosen by this repository.
 * None of them can hold anything a member typed.
 */
export interface Report {
  /** The error's constructor name — `TypeError`, `OfflineError`. Never the message. */
  name: string;
  /** SQLSTATE when the failure came from Postgres. Five characters, never data. */
  code: string | null;
  /** One of this repo's own identifiers, or null. Never a raw message. */
  identifier: string | null;
  route: Route;
  /** React component names. Not props, not state. */
  componentStack: string | null;
  schemaVersion: number | null;
  at: string;
}

/**
 * Reduce a message to a known identifier, or to nothing.
 *
 * Substring rather than equality, because Postgres wraps its own: the identifier appears inside
 * `violates check constraint "commitments_body_not_blank"`. Only the identifier is returned —
 * the surrounding message, and anything a `DETAIL` line dragged in with it, is dropped.
 */
export function identifierIn(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  for (const known of KNOWN_IDENTIFIERS) {
    if (message.includes(known)) return known;
  }
  return null;
}

/** A five-character SQLSTATE, or null. Anything else is not a code and is not copied. */
function sqlstateOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  const code = (cause as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * The route as a shape.
 *
 * The pathname is not copied. It is a small set of known values today, and the day somebody adds
 * `/member/:id` it would start carrying an identifier — after this file had already been
 * reviewed and forgotten.
 */
export function routeOf(pathname: string): Route {
  if (pathname.startsWith('/harness/')) return 'harness';
  if (pathname.startsWith('/auth')) return 'auth';
  if (pathname === '/' || pathname === '') return 'app';
  return 'unknown';
}

/**
 * Only component names survive.
 *
 * React's `componentStack` is a list of component names and source locations. The names are
 * safe; the source locations are paths from a build machine, which are not member data but are
 * noise, and a props snapshot would not be safe at all — so this keeps the names and nothing
 * else.
 */
export function componentNames(stack: unknown): string | null {
  if (typeof stack !== 'string') return null;
  const names = stack
    .split('\n')
    .map((line) => /^\s*(?:in|at)\s+([A-Za-z0-9_$]+)/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(' < ') : null;
}

export interface ReportContext {
  pathname?: string;
  componentStack?: unknown;
  schemaVersion?: number | null;
}

/**
 * Build the payload a third party may receive.
 *
 * Constructed field by field. Nothing is spread, nothing is copied wholesale, and the input
 * object is never returned in any form.
 */
export function toReport(cause: unknown, context: ReportContext = {}): Report {
  const name =
    typeof cause === 'object' && cause !== null && cause.constructor
      ? cause.constructor.name
      : typeof cause;

  return {
    name,
    code: sqlstateOf(cause),
    identifier: identifierIn(
      typeof cause === 'object' && cause !== null && 'message' in cause
        ? (cause as { message: unknown }).message
        : cause,
    ),
    route: routeOf(context.pathname ?? '/'),
    componentStack: componentNames(context.componentStack),
    schemaVersion: context.schemaVersion ?? null,
    at: new Date().toISOString(),
  };
}

/**
 * The single door.
 *
 * Nothing is wired to it yet, so this drops the report. It exists so that adding a reporter is
 * a one-line change *inside this function* rather than a call to a vendor SDK somewhere in a
 * component — and `tests/unit/import-graph.test.ts` fails if any other module imports a known
 * reporter SDK, which is what makes "the only door" true rather than a convention.
 */
export function report(cause: unknown, context: ReportContext = {}): Report {
  const payload = toReport(cause, context);
  // When a reporter is wired, it goes here, and it receives `payload` — never `cause`.
  return payload;
}
