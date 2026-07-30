# ADR-012: Filing a day is one RPC, not four client writes

**Status:** accepted
**Date:** 2026-07-30
**Phase:** 2

## Context

Filing a SITREP looks like a single write and is not. A complete or repeated day is one upsert
into `sitreps` plus a set of `protocol_results`. A **reset** is four operations:

1. the SITREP itself, with `final_status = 'reset'`;
2. a `reset_events` row recording the kind and the slugs that failed;
3. closing the current enrollment (`status = 'reset'`);
4. opening the successor enrollment, starting the day *after* the breach.

Two facts make doing this from the browser wrong.

**The network is expected to fail.** §3.10 exists because men will report from trains, gyms and
car parks. Four sequential writes over a flaky connection means four places to stop, and the
halfway states are worse than a clean failure: a reset recorded with no successor enrollment
leaves a man filing tomorrow against a closed campaign, and a successor with no `reset_events`
row loses the reason it happened — which is the data the whole product exists to accumulate.

**The outbox retries.** A queued entry that is re-sent after an ambiguous failure — the request
landed, the response did not — must converge on the same state rather than apply twice. Four
independent writes cannot give that; a second attempt would insert a second reset event and a
second successor enrollment, and "which day am I on" would have two answers.

## Decision

Filing a day is `public.file_sitrep(...)`, one function, one transaction. Joining a campaign is
`public.start_campaign_enrollment(...)` for the same reason.

Both are **SECURITY INVOKER**. This is the load-bearing part. They run as `authenticated`, so
every RLS policy in `0003_forge.sql` still applies to every statement inside them. A
`SECURITY DEFINER` version would be a hole in exactly the shape of the arguments: pass another
member's enrollment id and the policies would no longer be there to say no. `prosecdef = false`
is asserted in `tests/db/file-sitrep.test.ts`, because that flag can be flipped in a one-word
diff that reads as tidying.

`file_sitrep` is idempotent throughout: the SITREP is an upsert, the results are
delete-then-insert, the reset event is a guarded insert against a new unique index
(`reset_events_one_per_day`), and the successor enrollment is looked up before being created
against another new index (`enrollments_one_successor`, which also stops the chain forking).

Functions in `public` are EXECUTE-to-PUBLIC by default and the default privileges revoked in
`0001_baseline.sql` do not remove that grant. Both functions therefore revoke it explicitly and
grant only `authenticated`. `tests/db/rls-posture.test.ts` now enumerates every function in
`public` reachable by `anon` or `authenticated` against an allowlist, so the next RPC cannot be
added without someone deciding it should be API surface.

## What the function refuses, and why it is there rather than in the client

- **Another member's enrollment** (`42501`). RLS would reject it anyway; the explicit check
  exists so the error names the problem instead of saying "new row violates row-level security
  policy for table sitreps".
- **A reset being amended into something else** (`sitrep_reset_is_final`). The successor
  enrollment already exists and may already have days filed against it. Rewriting the day that
  closed this one would orphan them. Checked *before* the closed-enrollment rule, because both
  conditions hold at once and the generic message would send him looking for a current
  enrollment when the real answer is that this day is the one that ended it.
- **A reset on any day but the latest** (`sitrep_reset_not_latest`). The successor starts the day
  after the breach; if a later day already has a report against this enrollment, that date would
  belong to two enrollments and every aggregate over "day 1" would count it twice.
- **A late joiner back-dated to the campaign start.** `start_campaign_enrollment` starts him on
  the later of the campaign start and his own today. The enrollment trigger *permits* the earlier
  date, so this function is the only place the rule can live — and a client that chose its own
  start date could award itself the days it had not run.

## Consequences

- One retryable, atomic call per filed day, which is what the outbox needs to be honest.
- A closed enrollment accepts exactly one thing: another go at the reset that closed it. Without
  that exception the retry would be refused for ever by the state it had itself created — found
  by the idempotency test, not by review.
- `app.today_for()`'s body is now inlined a third time, in `start_campaign_enrollment`, because a
  SECURITY INVOKER function cannot look a name up in the `app` schema (the other side of
  ADR-011). Mirror notes name all three sites; a reconciliation test belongs with the Phase 9
  hardening pass.
- The Ledger's writes should follow the same shape when they arrive: a business action and its
  revenue entry are one operation from a man's point of view and should be one from the
  database's.
