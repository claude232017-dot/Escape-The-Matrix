# Runbook

Deploy, migrate, roll back, and the failures that present as something else.

## Local setup

```bash
npm ci
cp .env.example .env.local     # fill in the Supabase values
npm run dev
```

`npm run verify` runs the full gate: typecheck → lint → unit tests → database tests →
build. It must pass from a clean clone.

### API tests need a PostgREST

```bash
DATABASE_URL=… npm run test:api      # downloads PostgREST once, caches it in /tmp
POSTGREST_BIN=/path/to/postgrest DATABASE_URL=… npm run test:api   # or bring your own
```

This is the suite that runs the application's **own** query code — `loadForge`,
`sendVenture`, `sendSitrep` — against a real PostgREST, rather than against `pg`. It exists
because two Phase 4 bugs shipped with every other test green: a domain cast PostgREST emits
and the database tests do not, and an embed with no foreign key behind it. Neither is
visible without a real server.

It starts PostgREST itself and puts a small proxy in front so the real `getSupabase()`
client works unmodified — see `tests/api/harness.ts`. GoTrue is **not** part of it, so
signup and password recovery stay covered by the browser suite alone.

Not in `npm run verify`, for the same reason the browser suite is not: it needs something
fetched from the network. CI runs it in the database job, with the binary cached.

Browser tests are separate because they need a browser:

```bash
npm run build
npx playwright install chromium   # once
npm run test:browser
```

### Sandboxes with a mismatched Chromium

If Playwright refuses to launch because the installed browser build does not match the
Playwright release and no download is possible:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

CI leaves that variable unset and uses `playwright install`, so the pinned browser is what
actually gets tested.

### The browser suite needs the harness build

`npm run test:browser` previews whatever is in `dist`. The SITREP specs drive a harness route
that renders the screen with fixture data and no session — the only way to *measure* the
sixty-second filing gate rather than assert it. Build it first:

```bash
npm run build:harness   # tsc -b && vite build --mode harness
npm run test:browser
```

`--mode harness` is what loads `.env.harness`, which sets `VITE_TEST_HARNESS=1`. A plain
`npm run build` does not load that file, so the harness is eliminated from the bundle — the
route, the component and its fixtures. `tests/unit/harness-excluded.test.ts` performs a real
default-mode build and greps the output to prove it, and also fails if anyone adds the variable
to `.env` or `.env.production`.

If the SITREP specs fail with "sitrep not visible", the first thing to check is whether `dist`
is a production build.

## Database

Migrations live in `supabase/migrations`, are applied in **filename order**, and are
**forward-only**. Each runs in its own transaction, so a failed migration leaves nothing
behind and the run is repeatable.

```bash
# Apply to whatever DATABASE_URL points at. Safe against production.
DATABASE_URL=… npm run db:apply

# Local Postgres: also install the Supabase stand-in, and start from nothing
DATABASE_URL=… node scripts/db/apply-migrations.ts --shim --fresh

# Apply migrations and assert the security posture. LOCAL ONLY — see below.
DATABASE_URL=… npm run db:test
```

> ### `npm run db:test` drops the `public` schema
>
> It starts every run from nothing, so it is a **local-only** command. Pointing it at a
> real project would destroy every table there, including tables this project did not
> create.
>
> A guard now refuses `--fresh` against any non-local host and names the host it refused.
> The distance between "run the tests" and "destroy production" was one stale `export
> DATABASE_URL` in a shell, which is too short for a flag nobody re-reads.
>
> The override, `ALLOW_DESTRUCTIVE_DB_RESET=1`, exists for genuinely throwaway remote
> databases in CI. If you find yourself reaching for it against something you would miss,
> that is the guard working.
>
> `npm run db:apply` is **not** guarded, because applying migrations to production is the
> normal intended operation. Only the schema drop is.

`--shim` applies `supabase/local/00_shim.sql`, which recreates the `auth` schema,
`auth.uid()` and the `anon` / `authenticated` / `service_role` roles that Supabase provides
and a bare Postgres does not. **Never apply the shim to a real Supabase project** — it
would create objects that collide with the ones the platform manages.

### A local Postgres in one command

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name etm-db postgres:16
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
npm run db:test
```

### Rolling back a migration

There are no down-migrations. To undo, write a new forward migration that reverses the
change, and give it a name that says so. A down-migration that has never been executed is
not a rollback plan; it is an untested script that will be run for the first time during an
incident.

For a schema change that loses data, take a snapshot first — Supabase dashboard →
Database → Backups — and record the snapshot ID in the migration's comment.

## Bootstrapping a fresh project

Invitations can only be created by a mentor, and a mentor can only exist by accepting an
invitation. That circularity is deliberate — it is what makes the invite-only rule hold — so
it is broken once, by hand, by the owner.

1. Apply the migrations (SQL Editor, or `npm run db:apply`).
2. Edit the email in `supabase/bootstrap/01_first_mentor.sql` and run it. Safe to re-run: it
   reuses an existing circle, will not issue a duplicate live invitation, and does nothing
   once the mentor has joined.
3. Create the auth account for that address — **Authentication → Users → Add user**, with
   "Auto Confirm User" ticked. The `BEFORE INSERT` trigger checks the invitation, the
   `AFTER INSERT` trigger creates the profile as `mentor`, and the invitation is marked
   accepted.
4. Sign in. The invitation panel is now available, and everyone else joins through it.

Verify:

```sql
select p.display_name, p.role, p.timezone, c.name as circle
  from public.profiles p join public.circles c on c.id = p.circle_id;
```

### Opening a campaign

Until a campaign exists, the SITREP screen has nothing to offer and says so. Run
`supabase/bootstrap/02_first_campaign.sql` **after the mentor has signed in at least once** — it
resolves the start date in his timezone, which it can only read from his profile.

It creates the campaign and seeds the eleven protocols and five MED options. Safe to re-run:
it reuses a campaign of the same name and re-seeds idempotently. It prints the catalogue at the
end; **eleven protocols across five activation waves** is what DOCTRINE §2.0 says, and a
different count means the seed function and the doctrine have diverged.

It enrols nobody. Each man presses **Start Day 1** on his own screen, because Day 1 should be a
decision he makes rather than a row that appeared while he was asleep. Joining late does not
back-date him — `public.start_campaign_enrollment` starts him on the later of the campaign start
and his own today.

### Opening the Ledger

Run `supabase/bootstrap/03_business_actions.sql` before anyone opens the Ledger tab. It seeds
ADR-003's six leading indicators into the circle; until it runs, the Ledger shows a venture with
nothing to record against it, which reads as a broken screen rather than a missing setup step.

A script rather than a button for the same reason as the campaign: the action list *is* the
commercial doctrine. It decides what twelve men optimise for over thirty days, and getting it
wrong produces a month of the wrong work rather than a bad dashboard. Safe to re-run; it restores
anything deleted and leaves anything edited alone.

Members then add their own ventures from the Ledger tab — that part is theirs, not the mentor's.

A campaign is a once-a-month decision by one person, which is why it is a script and not a
screen. To run a second one, change `v_name` and `v_starts_on` and run it again; the first
campaign's history stays readable under the ruleset it was actually run under.

## Deploying

Hosted on Vercel. Framework preset Vite, build `npm run build`, output `dist`.

Environment variables to set in the Vercel project:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | The project URL |
| `VITE_SUPABASE_ANON_KEY` | The anon key |

Both are public and ship in the bundle — that is expected. See `docs/SECURITY.md`.

**Order matters:** apply migrations *before* deploying code that depends on them. The
reverse order gives every member a broken app for the length of the deploy.

---

## Known failure modes

### "Database error saving new user" on signup

**Presents as:** signup fails with an opaque message. Retrying reports "already
registered", and the person is stuck with no way forward.

**Actual cause:** the `AFTER INSERT` trigger on `auth.users` that creates the profile row
raised an exception, or is missing. The auth layer surfaces any exception from that trigger
as that one unhelpful string.

**Diagnosis:**

```sql
-- Is the trigger there at all?
select tgname, tgenabled from pg_trigger
 where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- Auth users with no profile: the signature of a trigger that failed or was dropped
select u.id, u.email, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
 order by u.created_at desc;

-- The trigger warns rather than raising, so the reason is in the Postgres log
-- (Supabase dashboard → Logs → Postgres), at WARNING level.
```

**Fix:** re-apply the migration that creates the trigger. Then backfill the orphans — a
missing profile is recoverable, which is exactly why that trigger swallows errors instead
of raising.

**Why it is built this way:** the profile trigger must *never* raise, because an
uncreatable auth user is not recoverable. The separate `BEFORE INSERT` trigger that
enforces invite-only *does* raise, because an uninvited signup must be blocked. Two
triggers with opposite failure rules; putting the blocking check inside the swallowing one
would enforce nothing.

### A member sees an empty screen where his own data should be

**Likely cause:** a table has RLS enabled and no policy, so every read returns zero rows.
It is not an error — it is silence.

```sql
select t.tablename
  from pg_tables t
 where t.schemaname = 'public' and t.rowsecurity
   and not exists (select 1 from pg_policies p
                    where p.schemaname = t.schemaname and p.tablename = t.tablename);
```

To read the RLS posture of every table by hand, use this — joining `pg_class` on
`relname` alone matches same-named tables in other schemas and can report another
schema's flags as though they were `public`'s:

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;
```

`npm run db:test` asserts this is empty. If it is failing in production, that test was not
run against production's schema.

### CI browser job times out having run zero tests

**Cause:** the preview server bound to a different address than the readiness check polled.
On a dual-stack runner `localhost` resolves to `::1` while the server listens on
`127.0.0.1`.

Both `vite.config.ts` and `playwright.config.ts` pin the literal `127.0.0.1`. Keep them the
same, and keep serving the built artifact rather than rebuilding inside the readiness
budget.

### A member's day rolls over at the wrong time

**Cause:** a calendar date derived from `toISOString()`, or from the browser's timezone
rather than `profiles.timezone`.

There is an ESLint rule banning `toISOString` in application code and a test asserting the
unit suite is not running in UTC. If either was disabled, re-enable it before fixing the
symptom. See `src/lib/date.ts`.

### `npm run tokens:build` changes a file that is already committed

Expected. `src/styles/tokens.css` is generated from `src/design/tokens.ts` and a test fails
if they drift. Commit the regenerated file. If you changed a colour, run the unit suite —
the contrast test may now be failing, which is the point.
