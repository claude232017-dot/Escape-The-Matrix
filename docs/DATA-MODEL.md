# Data model

**Status:** Phases 0 and 1 have shipped. Everything under "Planned" is a sketch to be refined
and migrated in its own phase; it is documented now because the shape of the schema decides
what the product can ever answer.

RLS is enabled on **every** table, with no permissive default. A verb with no policy is denied —
the absence *is* the enforcement.

`FORCE` row-level security is applied wherever it costs nothing, and deliberately **not** on the
two tables a `SECURITY DEFINER` signup trigger must read or write: `FORCE` subjects the owner to
its own policies, and the owner is who those functions run as, so forcing them would reject
every signup. The exemptions are a reasoned list in `tests/db/rls-posture.test.ts`, asserted to
be neither stale nor widened. See **ADR-010** — this reverses part of the Phase 0 posture.

---

## Shipped in Phase 0

### Domains (`app` schema, not exposed through the API)

| Domain | Definition | Why |
|---|---|---|
| `app.capped_text_140` | `text` with `char_length <= 140` | Every free-text field in this product is capped. The cap is a schema decision, not a UI suggestion; the client-side limit only exists to give a fast error. See ADR-001. |
| `app.currency_code` | `char(3)` matching `^[A-Z]{3}$` | Always stored beside a `bigint` of minor units. Mirrors `CURRENCY_EXPONENTS` in `src/lib/money.ts`. |

### `public.app_meta`

Single-row table carrying the schema and doctrine versions.

| Column | Type | Notes |
|---|---|---|
| `id` | `boolean` PK, default `true` | `CHECK (id)` is what makes it single-row rather than a convention nobody enforces |
| `schema_version` | `integer` | |
| `doctrine_version` | `text` | Points at the edition of `docs/DOCTRINE.md` the data was written under |
| `updated_at` | `timestamptz` | |

**Policies:** `SELECT` to `authenticated`, unconditionally — it is global, non-personal
version metadata with no per-member dimension to restrict on. This is one of two places in
the codebase where `USING (true)` appears, and it is registered as deliberate in
`tests/db/rls-posture.test.ts`. There is no `INSERT`, `UPDATE` or `DELETE` policy: version
bumps happen in migrations, which run as the owner.

### Schema-level posture

- `REVOKE CREATE ON SCHEMA public FROM public`
- Default privileges revoke all on tables, sequences and functions from `anon` and
  `authenticated`, so a new table arrives with **no grants** and must be granted
  explicitly, one verb at a time, beside the policy that constrains it.
- The `app` schema is not granted to `anon` or `authenticated` at all — nothing in it is
  reachable with an anon key, which makes it the right home for RLS predicates.

---

## Shipped in Phase 1

Identity, the circle, and invitations.

### `public.circles`

The private group. One row for a long time; modelled anyway, because retrofitting
multi-tenancy is expensive and doing it now is nearly free — and every RLS predicate below is
already scoped by it.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | 1–80 chars (`circles_name_length`) |
| `created_at` | `timestamptz` | |

RLS enabled **and forced**. `SELECT` to a member of that circle; no other verb has a policy, so
no other verb is permitted.

### `public.profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK → `auth.users` | `ON DELETE CASCADE` — deletion means deletion (§3.5) |
| `circle_id` | `uuid` → `circles` | `ON DELETE RESTRICT`; a circle with members cannot vanish |
| `display_name` | `text` | 1–60 (`profiles_display_name_length`) |
| `timezone` | `text` | CHECK `app.is_valid_timezone()`. Defaults `'UTC'` only so the signup trigger can never fail for want of a value |
| `role` | `member_role` | `mentor` \| `member` |
| `top_g_code` | `text` | ≤2000. His creed, shown inline by the Morning Protocol MED |
| `command_post_note` | `text` | ≤500 |
| `fortress_protocol` | `text` | ≤1000 |
| `disclosure_accepted_at` | `timestamptz` | ADR-009 |
| `disclosure_version` | `text` | ≤40 |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` maintained by trigger |

`profiles_disclosure_complete` requires both disclosure columns or neither: a timestamp with no
version cannot answer "what did he agree to", which is the only question it exists to answer.

RLS enabled, **not forced** — see ADR-010. Policies: `SELECT` where `circle_id` matches the
reader's; `UPDATE` where `id = auth.uid()`. **No `INSERT` policy**, deliberately — profiles are
created only by the signup trigger, and the absence *is* the enforcement. No `DELETE` policy.

Which columns a member may update is enforced by a **column-level grant**, not a policy:

```sql
grant update (display_name, timezone, top_g_code, command_post_note,
              fortress_protocol, disclosure_accepted_at, disclosure_version)
  on public.profiles to authenticated;
```

`role` and `circle_id` are simply not in the list, so self-promotion is rejected by the privilege
system before any policy runs. `WITH CHECK` cannot see `OLD`, so a policy could not express this
— and one that appeared to would be worse than an honest grant.

### `public.invitations`

The only route to membership.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `circle_id` | `uuid` → `circles` | `ON DELETE CASCADE` |
| `email` | `text` | CHECK lowercase (`invitations_email_lowercase`) and shape (`invitations_email_shape`) |
| `role` | `member_role` | the role the invitee will get |
| `token` | `text` unique | 16–128 chars, from `crypto.getRandomValues` |
| `invited_by` | `uuid` → `profiles` | `ON DELETE SET NULL` |
| `expires_at` | `timestamptz` | CHECK later than `created_at` |
| `accepted_at` | `timestamptz` | set by the signup trigger; consumes the invitation |
| `created_at` | `timestamptz` | |

Partial unique index `invitations_one_open_per_email` on `(email) WHERE accepted_at IS NULL` —
one live invitation per address, so revoking means revoking rather than hunting duplicates.

RLS enabled, **not forced** (ADR-010). All four verbs to the **mentor of that circle only**;
members get nothing, and the invitee has no session to read it with anyway.

### `app.circle_membership`

A denormalised `profile_id → (circle_id, role)` map, maintained by trigger, that exists solely
so RLS policies **on** `profiles` can ask "is this row in my circle?" without recursing through
`profiles`. See **ADR-011**. Unreachable with a public key: `anon` and `authenticated` have no
`USAGE` on `app`, asserted in `tests/db/rls-posture.test.ts`.

### Signup: two triggers on `auth.users`, with opposite failure rules

| Trigger | Timing | On error |
|---|---|---|
| `auth_users_enforce_invite` → `app.enforce_invite_only()` | `BEFORE INSERT` | **Raises** (SQLSTATE 42501). An uninvited email must not get an account. |
| `auth_users_create_profile` → `app.create_profile_for_new_user()` | `AFTER INSERT` | **Never raises.** Body wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW`. |

A missing profile is recoverable; an uncreatable auth user is not. GoTrue surfaces any exception
from this path as an opaque "Database error saving new user" that tells the person nothing and
reports "already registered" on retry. Putting the blocking check inside the swallowing trigger
would enforce nothing — which is why these are two triggers and not one.

Both are `SECURITY DEFINER` with `search_path` pinned to `''`. A `SECURITY DEFINER` function
with a mutable `search_path` is a privilege-escalation primitive, not a helper.

## Planned

### The Forge — Phase 2

- **`campaigns`** — `circle_id`, `name`, `starts_on`, `length_days`, `ruleset_version`.
- **`enrollments`** — `profile_id`, `campaign_id`, `started_on`, `status`,
  `previous_enrollment_id`. **A reset creates a new row; nothing is deleted.** The day
  count is derived from `started_on`.
- **`protocols`** — `campaign_id`, `slug`, `label`, `nickname`, `category`, `kind`
  (`duty` | `prohibition`), `activates_on_day`, `visibility`
  (`itemised` | `aggregate_only`), `is_treason_trigger`.
- **`protocol_med_options`** — `protocol_id`, `sort_order`, `label`, `body`. A separate
  table because Physical Forging offers a genuine choice of two, and a single text column
  cannot express that — it would flatten into prose the UI could not present as an
  either/or, and the chosen option could not be recorded.
- **`sitreps`** — `enrollment_id`, `local_date`, `final_status`
  (`complete` | `repeat` | `reset`), `submitted_at`. Unique on `(enrollment_id,
  local_date)`. Mirror note: `local_date` is resolved by `getLocalDateString(tz)` before
  it arrives; storing a `timestamptz` and casting here would reintroduce the UTC rollover
  bug server-side.
- **`protocol_results`** — `sitrep_id`, `protocol_id`, `status`
  (`pass` | `med_pass` | `fail`), `med_option_id` nullable.
- **`debriefs`** — `sitrep_id` 1:1, plus the fields in DOCTRINE §6.
- **`reset_events`** — `enrollment_id`, `occurred_on`, `kind`, `reason`,
  `protocols_failed`.

### The Ledger — Phase 4

- **`ventures`** — `owner_id`, `name`, `kind`, `status`, `started_on`.
- **`business_actions`** — the catalogue of leading indicators: `slug`, `label`, `unit`.
- **`daily_business_entries`** — `profile_id`, `local_date`, `venture_id`, `action_id`,
  `count`. Unique on the tuple — **this is the outbox coalescing key**.
- **`money_entries`** — `venture_id`, `occurred_on`, `direction`, `amount_minor` (`bigint`),
  `currency` (`app.currency_code`), `category`, `is_recurring`.
- **`commitments`** — `profile_id`, `week_start`, `text` (`app.capped_text_140`),
  `outcome` (`pending` | `hit` | `missed`), `resolved_at`. **Max three per week, by
  constraint.**

### Command — Phases 5–7

- **`weekly_reviews`** — `profile_id`, `week_start`, three capped structured fields, plus a
  **snapshot of the computed numbers**. Not optional: recomputing history from live
  definitions means a man's past weeks silently change when the mentor edits the protocol
  list. Store what was true at the time.
- **`mentor_directives`** — `author_id`, `subject_id`, `week_start`, `body` (capped).
  Visible to author and subject only.
- **`playbooks`** / **`playbook_applications`**.

---

## Conventions

- **Money** is always two columns: `bigint` minor units + `app.currency_code`. Never a
  float, never `double precision`, at any layer.
- **Dates** that represent a member's day are Postgres `date`, resolved in his timezone
  before insert. Timestamps that represent an instant are `timestamptz`.
- **Free text** uses `app.capped_text_140` unless there is a documented reason not to.
- **Enums** are Postgres enum types, so an invalid value cannot be stored even by a client
  that skipped validation.
- **Nothing is deleted** on a reset. History is append-only where it records what a man
  did.
