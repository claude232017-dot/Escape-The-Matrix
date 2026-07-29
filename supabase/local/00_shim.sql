-- NOT A MIGRATION. Never applied to a Supabase project.
--
-- Supabase provides the `auth` schema, the `auth.uid()` / `auth.jwt()` helpers and the
-- anon / authenticated / service_role roles. A bare Postgres does not, so migrations
-- that reference them cannot be applied — and therefore cannot be *tested* — without
-- this stand-in.
--
-- Being able to run the real migrations against a real Postgres in CI is the difference
-- between "I reviewed the policies" and knowing they behave. The shim reproduces the
-- interface the migrations depend on and nothing else; if a migration needs something
-- from Supabase that is not here, the test fails loudly rather than skipping.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Mirrors GoTrue's users table closely enough for triggers and foreign keys to be
-- exercised. Only the columns the app actually touches are reproduced.
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The request's claims. Supabase populates request.jwt.claims per statement from the
-- verified JWT; tests set the same GUC to impersonate a member.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.email', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )
$$;
