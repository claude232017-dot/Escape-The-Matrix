-- 0001_baseline.sql — Phase 0
--
-- Establishes the security posture every later migration inherits. There are no domain
-- tables yet; what this creates is the shape of the rules.
--
-- The governing principle: anything enforced only in the browser is decoration. The anon
-- key is public and ships in the bundle, so "who may read this row" is answered here or
-- it is not answered at all.

-- gen_random_uuid() for primary keys.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Default-deny, at the schema level
-- ---------------------------------------------------------------------------
-- Supabase exposes `public` through PostgREST to the `anon` and `authenticated` roles.
-- Revoking CREATE stops a future migration from accidentally granting the API surface
-- something nobody reviewed, and the default privileges below mean a newly created table
-- arrives with no grants at all: it must be granted explicitly, one verb at a time,
-- alongside the RLS policy that constrains it.
revoke create on schema public from public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- app: internal helpers, never exposed through the API
-- ---------------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from anon, authenticated;
comment on schema app is
  'Internal helper functions and types. Not exposed through PostgREST: nothing here is '
  'reachable with an anon key, so it is a safe place for the predicates RLS policies '
  'depend on.';

-- ---------------------------------------------------------------------------
-- Shared domains
-- ---------------------------------------------------------------------------

-- Every free-text field in this product is capped. A capped column is a schema decision,
-- not a UI suggestion: the client-side limit exists to give a fast error, and this exists
-- to make the rule true. Mirror note: the client-side caps live with each feature's
-- validation module and name this constraint.
-- Guarded rather than `drop domain if exists ... cascade`: once columns are typed with
-- this domain, a cascading drop would silently take the columns with it. `create domain`
-- has no IF NOT EXISTS, so the existence check is explicit.
do $$
begin
  if not exists (
    select 1 from pg_type t
     where t.typname = 'capped_text_140' and t.typnamespace = 'app'::regnamespace
  ) then
    create domain app.capped_text_140 as text
      constraint capped_text_140_length check (value is null or char_length(value) <= 140);
  end if;
end
$$;

comment on domain app.capped_text_140 is
  'Short structured prose: a commitment, a propaganda line, a debrief field. 140 '
  'characters because the point is a specific claim, not a paragraph. See ADR-001 — the '
  'product has no free-text journal.';

-- ISO-4217 alphabetic code. Mirror note: the supported set is CURRENCY_EXPONENTS in
-- src/lib/money.ts; adding a currency there means adding it here, or inserts are
-- rejected at runtime.
do $$
begin
  if not exists (
    select 1 from pg_type t
     where t.typname = 'currency_code' and t.typnamespace = 'app'::regnamespace
  ) then
    create domain app.currency_code as char(3)
      constraint currency_code_format check (value ~ '^[A-Z]{3}$');
  end if;
end
$$;

comment on domain app.currency_code is
  'ISO-4217 alphabetic currency code. Always stored beside an amount in integer minor '
  'units (bigint) — never a float, at any layer. See src/lib/money.ts.';

-- A calendar date resolved in the *member''s* timezone before it ever reaches the
-- database. Postgres `date` holds no zone, which is exactly right: the zone question is
-- settled on the way in, by getLocalDateString(tz) in src/lib/date.ts. Storing a
-- timestamptz and casting to date here would reintroduce the UTC rollover bug on the
-- server side.
comment on schema public is
  'Application tables. Every table has RLS enabled with no permissive default; see '
  'docs/SECURITY.md for the table x role x verb matrix.';

-- ---------------------------------------------------------------------------
-- app_meta: schema and ruleset version
-- ---------------------------------------------------------------------------
-- Also the Phase 0 proof that the whole pipeline works end to end: a migration applies,
-- a table exists, RLS is on, and the guardrail test in tests/db can see all three.
-- Idempotent throughout: this file gets pasted into the Supabase SQL editor by hand for
-- the first deployment, and a migration that half-applies and then errors on the second
-- attempt is how someone ends up unpicking state by hand at the worst moment.
create table if not exists public.app_meta (
  id boolean primary key default true constraint app_meta_single_row check (id),
  schema_version integer not null,
  -- Versioned alongside docs/DOCTRINE.md. The rules will be tuned between campaigns and
  -- a year from now nobody will remember why a zero day is three protocols rather than
  -- two; the doctrine doc is the source of truth and this is the pointer to which
  -- edition of it the data was written under.
  doctrine_version text not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_meta is
  'Single-row table carrying the schema and doctrine versions. The CHECK on the primary '
  'key is what makes it single-row rather than a convention nobody enforces.';

alter table public.app_meta enable row level security;
alter table public.app_meta force row level security;

-- Readable by any signed-in member, writable by nobody through the API: version bumps
-- happen in migrations, which run as the owner and bypass RLS. There is deliberately no
-- INSERT, UPDATE or DELETE policy — under RLS a verb with no policy is denied, so the
-- absence here is the enforcement.
drop policy if exists app_meta_select_authenticated on public.app_meta;
create policy app_meta_select_authenticated
  on public.app_meta
  for select
  to authenticated
  using (true);

grant select on public.app_meta to authenticated;

insert into public.app_meta (schema_version, doctrine_version)
values (1, '2026.07-draft')
on conflict (id) do update
  set schema_version = excluded.schema_version,
      doctrine_version = excluded.doctrine_version,
      updated_at = now();
