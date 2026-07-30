-- 0007_domains_to_public.sql — Phase 4 fix
--
-- Move the shared domains out of `app` and into `public`.
--
-- ---------------------------------------------------------------------------
-- The bug, in full, because it was invisible to every test
-- ---------------------------------------------------------------------------
-- Naming a venture failed with `permission denied for schema app`, and booking money would have
-- failed the same way on the next tap.
--
-- `authenticated` deliberately has no USAGE on the `app` schema (ADR-011). That is fine for
-- functions, because an RLS policy stores the function's OID when the policy is created, so no
-- name lookup happens at runtime. It is **not** fine for a domain used as a column type: PostgREST
-- writes a schema-qualified cast for domain columns —
--
--     insert into public.ventures (kind) values ($1::app.capped_text_140)
--
-- — and resolving `app.capped_text_140` at parse time needs USAGE on the schema. The role does not
-- have it, so the statement is rejected before RLS is ever consulted.
--
-- Why the whole suite was green: the database tests write with plain SQL literals, which need no
-- cast, and every earlier write of a capped column went through a SECURITY DEFINER RPC where the
-- cast is parsed as the owner. `ventures.kind` was the first `app.` domain written directly by a
-- browser, and it failed the first time a real person typed into it.
--
-- Mirror note: tests/db/ledger-rls.test.ts now inserts through an explicit
-- `::public.capped_text_140` cast as `authenticated`, which is what reproduces this.
--
-- ---------------------------------------------------------------------------
-- Why moving them is the right fix rather than granting USAGE
-- ---------------------------------------------------------------------------
-- Granting `usage on schema app to authenticated` would also work, and it is the wrong shape.
-- ADR-011 keeps the schema unreachable so that the membership map and the predicates over it
-- cannot be probed by anyone holding the public anon key; widening that to fix a type lookup
-- trades a security boundary for a convenience.
--
-- A domain is not a helper. It is the type of a column that `authenticated` is already allowed to
-- read and write, and every table using it is in `public`. It belongs beside them. Nothing about
-- moving it grants access to anything — a type carries no rows.
--
-- `ALTER DOMAIN ... SET SCHEMA` re-points every dependent column automatically, so no data moves
-- and no table is rewritten.

-- ---------------------------------------------------------------------------
-- Three states, because 0001 re-creates the domain on every re-apply
-- ---------------------------------------------------------------------------
-- 0001 guards its `create domain` with "does this exist **in app**". Once this migration has
-- run, that answer is no, so a re-apply faithfully re-creates `app.capped_text_140` — an orphan
-- with no dependent columns, because the tables were re-pointed at `public` the first time
-- through. Moving it then collides with the one already in `public`.
--
-- The fix belongs here rather than in 0001. Migrations are forward-only (docs/RUNBOOK); editing
-- an applied one to fix a later one's assumptions is how a schema stops matching its own history.
-- So this migration handles every state it can find rather than assuming one:
--
--   in `app` only     → move it, the first-run case
--   in `public` only  → nothing to do
--   in both           → drop the `app` orphan a re-apply just made
--
-- The drop is RESTRICT (the default, stated explicitly). If a column somewhere really does still
-- depend on the `app` domain, this migration fails loudly instead of cascading a column away.
do $$
declare
  d text;
  in_app boolean;
  in_public boolean;
begin
  foreach d in array array['capped_text_140', 'currency_code'] loop
    in_app := exists (
      select 1 from pg_type t
       where t.typname = d and t.typnamespace = 'app'::regnamespace and t.typtype = 'd'
    );
    in_public := exists (
      select 1 from pg_type t
       where t.typname = d and t.typnamespace = 'public'::regnamespace and t.typtype = 'd'
    );

    if in_app and in_public then
      execute format('drop domain app.%I restrict', d);
    elsif in_app then
      execute format('alter domain app.%I set schema public', d);
    elsif not in_public then
      raise exception 'domain %  is in neither app nor public; 0001 did not run', d;
    end if;
  end loop;
end
$$;

comment on domain public.capped_text_140 is
  'Short structured prose: a commitment, a propaganda line, a debrief field. 140 characters '
  'because the point is a specific claim, not a paragraph. See ADR-001 — the product has no '
  'free-text journal. Lives in `public` because PostgREST casts to it by name on every write, and '
  '`authenticated` has no USAGE on `app` (ADR-011).';

comment on domain public.currency_code is
  'ISO-4217 alphabetic currency code. Always stored beside an amount in integer minor units '
  '(bigint) — never a float, at any layer. See src/lib/money.ts. In `public` for the same reason '
  'as capped_text_140.';

update public.app_meta set schema_version = 7, updated_at = now() where id;
