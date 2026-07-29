# ADR-011 — `app.circle_membership`, a denormalisation to break RLS recursion

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 1

## Context

A member must be able to see the other men in his circle — that is what a circle is. The policy
is therefore "this row is visible if its `circle_id` matches mine".

Finding "mine" means reading the reader's own `circle_id` from `public.profiles`. But the policy
being evaluated is a policy **on** `public.profiles`, so evaluating it requires evaluating it.
Postgres detects this and reports:

```
ERROR: infinite recursion detected in policy for relation "profiles"
```

It does not name the policy, the column, or the query. In a schema with a dozen tables that
message is a long afternoon.

## Decision

Keep a minimal membership map in the `app` schema:

```sql
create table app.circle_membership (
  profile_id uuid primary key,
  circle_id  uuid not null,
  role       public.member_role not null
);
```

The RLS predicates read from **there**, via `SECURITY DEFINER` functions with `search_path`
pinned:

```sql
create policy profiles_select_own_circle on public.profiles
  for select to authenticated
  using (circle_id = app.current_circle_id());
```

Kept in step by a trigger on `public.profiles` — never by hand.

`app` is granted to nobody: `anon` and `authenticated` have no `USAGE` on it, so the table is
unreachable with a public key. RLS is enabled on it anyway with **no policies**, so a future
migration that grants `USAGE` by accident is a non-event rather than a disclosure.

## Options considered

### A. Store `circle_id` in the JWT as a custom claim — rejected

Genuinely the cleanest answer: no extra table, no recursion, and the value travels with the
request.

**Cost:** it requires a Supabase Auth Hook to inject the claim, which is configuration living
outside the migrations — so a fresh project would apply every migration, pass every test, and
still be broken until someone remembered a dashboard setting. It also makes membership changes
take effect only on token refresh, meaning a man moved between circles keeps the old one for up
to an hour. **Worth revisiting** if the claim ever needs to carry more than this, but not for
one uuid.

### B. `SECURITY DEFINER` function reading `public.profiles` directly — rejected

The obvious fix, and the one most examples show.

**Cost:** it only works because `SECURITY DEFINER` runs as the owner and the owner bypasses RLS
— which stops being true the moment anyone adds `FORCE ROW LEVEL SECURITY` to `profiles`, and
adding `FORCE` is exactly the sort of thing a security-minded reviewer does. The recursion would
come back, in a migration whose author had no idea they were coupled. See ADR-010; this design
deliberately does not depend on that subtlety.

### C. Drop the same-circle read entirely — rejected

Members would see only themselves.

**Cost:** it removes the circle from a product about a circle. Report status, commitments and
whether a man was hit are the whole accountability mechanism.

### D. Denormalised map in `app` — chosen

**Cost, honestly:** it is duplicated state, and duplicated state drifts. Two things contain that.
It is written only by trigger, so there is no code path that updates one and forgets the other.
And it is small enough to rebuild from scratch in a single statement if it ever does drift:

```sql
insert into app.circle_membership (profile_id, circle_id, role)
select id, circle_id, role from public.profiles
on conflict (profile_id) do update
  set circle_id = excluded.circle_id, role = excluded.role;
```

The second cost is conceptual: a reader of `0002_identity.sql` sees a table that looks
redundant and may "tidy it away". Hence the comment in the migration, and hence this ADR.

## Consequences

- Every RLS predicate in later phases should scope through `app.current_circle_id()` rather than
  reading `public.profiles`, and gets recursion-freedom for nothing.
- `app.is_mentor()` comes out of the same table, so the mentor check has the same property.
- A reconciliation test belongs in Phase 9's hardening pass: assert `app.circle_membership`
  agrees with `public.profiles` row for row, so drift is detected rather than assumed absent.
