# ADR-010 — `FORCE` row-level security is not a blanket rule

**Status:** Accepted — **reverses part of the Phase 0 posture**
**Date:** 2026-07-29
**Phase:** 1

## Context

Phase 0's guardrail asserted `FORCE ROW LEVEL SECURITY` on every table in `public`, on the
reasoning that without it the table owner bypasses its own policies, so a code path that ends
up connected as the owner reads everything while the policies look correct.

That reasoning is sound in general. It is wrong here, and Phase 1 is where it broke.

`FORCE` makes the owner subject to the table's policies — and the owner is exactly who a
`SECURITY DEFINER` function runs as. Phase 1 needs two of those, on `auth.users`:

- the invite check reads `public.invitations` **before any session exists**, so `auth.uid()`
  is null;
- profile creation **inserts into `public.profiles`**, which deliberately has no `INSERT`
  policy at all, because profiles are meant to be created only by that trigger.

Under `FORCE`, the first matches no rows and **every signup is rejected**; the second is denied
outright and every new member gets an account with no profile. Both failures present as the
opaque GoTrue message "Database error saving new user".

## Decision

`FORCE` where it costs nothing; **not** on tables a `SECURITY DEFINER` path must read or write.
The exemptions are an explicit list with reasons, in `tests/db/rls-posture.test.ts`:

| Table | Why not forced |
|---|---|
| `public.profiles` | `app.create_profile_for_new_user()` inserts here as the owner, and there is no INSERT policy by design |
| `public.invitations` | `app.enforce_invite_only()` reads here as the owner, before the user has a session |

`public.circles` and `public.app_meta` **are** forced: nothing definer-touches them.

## Why this is not a weakening

`FORCE` was never load-bearing in this architecture. Application traffic arrives through
PostgREST as `anon` or `authenticated` and **never as the owner**. So `FORCE` constrains only
migrations and the trigger functions — both of which are trusted code in this repository,
reviewed in the same diff as the policies they sit beside.

What actually enforces isolation is the policies plus the grants, and those are asserted
directly: `tests/db/identity-rls.test.ts` authenticates as member A and gets zero rows from
member B, on every table and every verb.

## Options considered

### A. Keep `FORCE` everywhere and add permissive policies for the triggers — rejected

Would work, and is the option that looks most like "not weakening anything".

**Cost:** it is strictly worse. To let the definer functions through, `invitations` would need a
`SELECT` policy broad enough to match with `auth.uid() = null` — which is a policy that matches
for *anybody*, written in the one file where a reviewer is most likely to skim. The blanket rule
would be preserved and the actual protection reduced. A rule that forces you to write a
permissive policy is worse than an honest exemption.

### B. Drop the assertion — rejected

**Cost:** loses the review pressure entirely. A future table would lose `FORCE` and nothing
would notice.

### C. Reasoned exemption list — chosen

**Cost:** the list needs maintaining, and a lazy reviewer can add to it rather than think. Two
things narrow that: adding an entry requires writing the reason, and a second test asserts the
list is neither stale (an exempted table that no longer exists) nor obsolete (an exempted table
that has since gained `FORCE`), so it cannot quietly rot.

## Verified

Mutation-tested through the migration, not against the database — the suite drops and recreates
the schema in `beforeAll`, so an out-of-band change is wiped before the assertions run, and the
first attempt at this silently passed. Adding a `GRANT USAGE ON SCHEMA app` to the migration
fails 2 tests; removing an `ENABLE ROW LEVEL SECURITY` line fails 1.

## Consequence for the reader

If a future phase adds a table that a `SECURITY DEFINER` function must touch, expect the
posture test to fail and **do not reach for a permissive policy**. Add the exemption with its
reason. If a table does *not* need definer access, force it.
