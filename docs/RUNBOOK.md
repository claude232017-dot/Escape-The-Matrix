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

## Database

Migrations live in `supabase/migrations`, are applied in **filename order**, and are
**forward-only**. Each runs in its own transaction, so a failed migration leaves nothing
behind and the run is repeatable.

```bash
# Apply to whatever DATABASE_URL points at
DATABASE_URL=… npm run db:apply

# Local Postgres: also install the Supabase stand-in, and start from nothing
DATABASE_URL=… node scripts/db/apply-migrations.ts --shim --fresh

# Apply migrations and assert the security posture
DATABASE_URL=… npm run db:test
```

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
