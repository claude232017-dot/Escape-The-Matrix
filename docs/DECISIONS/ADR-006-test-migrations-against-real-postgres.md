# ADR-006 — Test migrations and RLS against a real Postgres, via a local shim

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0

## Context

Given what this app stores — per-identified-individual compliance with a sexual-discipline
protocol, substance use, and a catalogue of a named man's psychological weak points — a gap
in row-level security is a serious incident, not a bug.

And a `USING (true)` left over from a debugging session **looks exactly like a correct
policy** in a diff. "I reviewed the policies" cannot catch it.

## Decision

Apply the real migrations to a **real Postgres** in CI and in `npm run verify`, then
interrogate the catalogue with assertions.

Because a bare Postgres has no `auth` schema, no `auth.uid()` and none of the
`anon`/`authenticated`/`service_role` roles, `supabase/local/00_shim.sql` recreates exactly
that interface — and nothing else. It is explicitly **not a migration** and is never applied
to a Supabase project.

## Options considered

### A. Read the policies and reason about them — rejected

**Cost:** this is the status quo that produces the incident. It cannot detect a policy that
is syntactically fine and semantically wide open.

### B. Mock the database — rejected

**Cost:** a mock cannot have a row-level security policy. It would test the code's beliefs
about the database rather than the database, which is precisely inverted for a rule whose
entire purpose is to hold when the client is wrong.

### C. Run the Supabase CLI (Docker) in CI — rejected for now

The most faithful option: it brings up real GoTrue, real PostgREST, real everything.

**Cost:** slow to start, heavy in CI, and it makes the local test loop depend on Docker
being available and healthy. It also does not remove the need for the catalogue assertions —
it only changes what is underneath them.

**Revisit at Phase 1**, when signup triggers need real GoTrue behaviour to be tested
properly. The shim reproduces `auth.users` closely enough for triggers and foreign keys, but
it is not GoTrue, and the "Database error saving new user" failure mode is a GoTrue
behaviour.

### D. Real Postgres plus a minimal shim — chosen

**Cost:** the shim is a second definition of an interface Supabase owns, and it can drift
from the real thing. Mitigated by keeping it minimal: it reproduces only what the migrations
actually touch, so a migration that depends on something not in the shim fails loudly rather
than being skipped.

## What is asserted

On every table in `public`: RLS enabled; RLS **forced**, so the owning role is not exempt
from its own policies; at least one policy present; no unreviewed `USING (true)`; no
unconditional write; no grant to `anon`. Plus the domain constraints — the 140-character cap
and the currency format — checked at the storage layer rather than trusted to the client.

## Verified by mutation

Adding a table with no RLS, a table with a `USING (true)` policy, and an `anon` grant makes
**four assertions fail, each naming the specific defect**. A guardrail that has never been
seen to fail is not a guardrail.
