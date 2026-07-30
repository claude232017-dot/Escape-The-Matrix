# ADR-013: The debrief is two tables, split by who may read it

**Status:** accepted
**Date:** 2026-07-30
**Phase:** 3

## Context

A debrief has two halves, and DOCTRINE §6 treats them as one feature because a man fills them in
together. They are not one feature from a privacy standpoint.

The **Top G Insight** is a system that worked — "laying gym clothes out the night before meant I
was out the door before the Bottom G could negotiate". Sharing that is the entire reason a circle
exists, and Phase 7's playbooks are built by aggregating them.

The **Bottom G Tactic** is the hour a specific named man is psychologically weakest, the trigger
that reliably beats him, and the exact sentence he uses to talk himself into losing. Across thirty
days that is not a diary entry. It is a profile of how to break him, held about someone the other
readers know personally and see every week.

DOCTRINE §7 already draws the line: what a member sees of another is his report status, his
commitments, and **whether he was hit**. Not how.

## Decision

Two tables.

- **`public.debriefs`** — `system_used`, `victory`, `insight_protocol_id`, plus `attacked` and
  `outcome`. Circle-readable.
- **`public.bottom_g_tactics`** — `occurred_at_hour`, `trigger_kind`, `propaganda`, `protocol_id`.
  Readable by the man himself and by the mentor (ADR-009), and by nobody else.

Both are 1:1 with a SITREP. `public.file_debrief` writes them in one transaction (ADR-012), and a
cross-table trigger rejects a tactic on a day the debrief says was quiet — otherwise a peer can
read `attacked = false` while the mentor reads a 15:00 ambush, and both believe they are looking
at the same day.

### The alternative, and why it was rejected

One table with a policy that returns it only to the owner and the mentor would satisfy the same
rule today. It was rejected because Postgres row-level security is **row**-level: it cannot return
a row with some columns redacted. Getting per-column visibility from one table means either a view
per audience — which is a second object with a second policy that has to stay in step — or an
application layer deciding which columns to send, which §3.3 calls decoration.

The deciding argument is what the two shapes fail like. With one table, someone widening the
insight to the circle (a correct, desirable change) has to remember that the same policy governs
the propaganda field. The failure is silent, it looks like a small improvement in the diff, and
nothing about it announces that special-category-adjacent data just became visible to eleven
people. With two tables the columns are simply not in the table a peer may read, so the equivalent
mistake requires deliberately writing a new policy on a table whose header says who it is for.

The cost is real and accepted: two inserts instead of one, a cross-table invariant that needs a
trigger, and a join whenever both halves are wanted. That is a fair price for making the dangerous
mistake require intent.

## Consequences

- `tests/db/debrief-rls.test.ts` asserts a peer gets **zero rows** from `bottom_g_tactics` while
  reading the insight and the `attacked` flag normally. Mutation-verified: dropping
  `app.is_mentor()` from the tactic policy fails that test.
- Both tables carry a DELETE grant, unlike `sitreps`, `enrollments` and `reset_events`. A debrief
  is a man's own reflection rather than a record of what he did, and "I was not attacked after
  all" has to be expressible. ADR-002's history is untouched either way.
- The pattern readback (`AttackPatternPanel`) can only ever show a man his own data, because the
  query underneath it cannot return anyone else's. The circle-wide version in Phase 6 will need a
  deliberate aggregate that never itemises — and it will have to be written as such rather than
  falling out of a widened policy.
- **Export (Phase 8) must include `bottom_g_tactics`.** It is the member's own data and §3.5 says
  export means everything he owns. The restriction is on peers, not on him.
