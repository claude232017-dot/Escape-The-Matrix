# Data model

**Status:** Phase 0 ships the baseline only. Everything under "Planned" is a sketch to be
refined and migrated in its own phase; it is documented now because the shape of the
schema decides what the product can ever answer.

RLS is enabled **and forced** on every table, with no permissive default. A verb with no
policy is denied — the absence *is* the enforcement.

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

## Planned

### Identity and circle — Phase 1

- **`circles`** — the private group. One row for a long time; modelled anyway, because
  retrofitting multi-tenancy is expensive and doing it now is nearly free.
- **`profiles`** — `id` (FK `auth.users`), `display_name`, `timezone`, `role`
  (`mentor` | `member`), `circle_id`, `top_g_code`, `command_post_note`.
  `timezone` is not optional: every day count, week boundary and SITREP deadline is
  computed against it.
- **`invitations`** — `email`, `circle_id`, `token`, `expires_at`, `accepted_at`. The only
  route to membership.

Two triggers on `auth.users`, with **opposite failure rules**, which is why they are two
and not one:

| Trigger | Timing | On error |
|---|---|---|
| Invite check | `BEFORE INSERT` | **Raises.** An uninvited email must not get an account. |
| Profile creation | `AFTER INSERT`, `SECURITY DEFINER`, `search_path` pinned | **Never raises** — body wrapped in `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW`. |

A missing profile is recoverable; an uncreatable auth user is not. The auth layer surfaces
any exception as an opaque "Database error saving new user" that tells the person nothing,
and a client-side profile insert runs in a separate transaction — so a failure there leaves
an auth user with no profile, an account that exists and cannot be used and reports
"already registered" on retry with no way out. Putting the blocking check inside the
swallowing trigger would enforce nothing.

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
