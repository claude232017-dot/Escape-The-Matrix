-- 0002_identity.sql — Phase 1
--
-- Identity, the circle, and invitations. The goal of this migration is one sentence:
-- **the right men get in and nobody else does**, and that is decided here rather than in
-- the browser, because the anon key is public and every client-side check is decoration.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'member_role' and typnamespace = 'public'::regnamespace
  ) then
    create type public.member_role as enum ('mentor', 'member');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Timezone validation, mirroring isValidTimeZone() in src/lib/date.ts
-- ---------------------------------------------------------------------------
-- A CHECK cannot contain a subquery against pg_timezone_names, so the validation is a
-- function. It exists because every day count, week boundary and SITREP deadline is
-- computed against profiles.timezone: an unparseable value there does not fail loudly,
-- it silently misattributes a man's day.
create or replace function app.is_valid_timezone(tz text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if tz is null or tz = '' then
    return false;
  end if;
  perform now() at time zone tz;
  return true;
exception
  when others then
    return false;
end
$$;

comment on function app.is_valid_timezone(text) is
  'True when Postgres recognises the IANA zone. Mirror of isValidTimeZone() in '
  'src/lib/date.ts — changing the accepted set means changing both.';

-- ---------------------------------------------------------------------------
-- circles
-- ---------------------------------------------------------------------------
-- One row for a long time. Modelled anyway: retrofitting multi-tenancy is expensive and
-- doing it now is nearly free, and every RLS predicate below is already scoped by it.
create table if not exists public.circles (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null constraint circles_name_length check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

alter table public.circles enable row level security;
-- Forced, unlike profiles and invitations: no SECURITY DEFINER function reads this table,
-- so the owner has no legitimate need to bypass its policies. The two tables that are not
-- forced are listed with reasons in tests/db/rls-posture.test.ts.
alter table public.circles force row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  -- Not just a foreign key: the profile IS the auth user, one row each, and the cascade
  -- means deletion means deletion (§3.5).
  id uuid primary key references auth.users (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete restrict,
  display_name text not null
    constraint profiles_display_name_length check (char_length(display_name) between 1 and 60),

  -- Every day count, week boundary and SITREP deadline is computed against this. A man
  -- who travels does not lose a day. Defaults to UTC only so the trigger can never fail
  -- for want of a value; onboarding must make the member confirm it.
  timezone text not null default 'UTC'
    constraint profiles_timezone_valid check (app.is_valid_timezone(timezone)),

  role public.member_role not null default 'member',

  -- His creed, shown inline by the Morning Protocol MED at the moment it is meant to be
  -- read aloud. A MED that says "read your Code" without showing the Code is friction at
  -- exactly the wrong moment — the low-energy morning it exists to rescue.
  top_g_code text constraint profiles_top_g_code_length check (char_length(top_g_code) <= 2000),
  command_post_note text
    constraint profiles_command_post_length check (char_length(command_post_note) <= 500),
  fortress_protocol text
    constraint profiles_fortress_length check (char_length(fortress_protocol) <= 1000),

  -- The mentor sees full protocol detail, including special-category data, and the
  -- member is told so before he files anything. The disclosure is what makes the access
  -- legitimate, so its acceptance is recorded rather than assumed. See ADR-009.
  disclosure_accepted_at timestamptz,
  disclosure_version text
    constraint profiles_disclosure_version_length check (char_length(disclosure_version) <= 40),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Either both disclosure columns are set or neither is. A timestamp with no version
  -- cannot answer "what did he actually agree to", which is the only question it exists
  -- to answer.
  constraint profiles_disclosure_complete check (
    (disclosure_accepted_at is null) = (disclosure_version is null)
  )
);

alter table public.profiles enable row level security;

create index if not exists profiles_circle_id_idx on public.profiles (circle_id);

-- ---------------------------------------------------------------------------
-- invitations — the only route to membership
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,

  -- Stored lowercased and compared lowercased. Email case-sensitivity is how an invited
  -- man gets told he was not invited.
  email text not null
    constraint invitations_email_lowercase check (email = lower(email))
    constraint invitations_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  role public.member_role not null default 'member',
  token text not null unique
    constraint invitations_token_length check (char_length(token) between 16 and 128),
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),

  constraint invitations_expiry_after_creation check (expires_at > created_at)
);

alter table public.invitations enable row level security;

-- One live invitation per address at a time. Without this, revoking an invitation means
-- finding every duplicate, and a stale row keeps the door open.
create unique index if not exists invitations_one_open_per_email
  on public.invitations (email)
  where accepted_at is null;

create index if not exists invitations_circle_id_idx on public.invitations (circle_id);

-- ---------------------------------------------------------------------------
-- app.circle_membership — the non-recursive membership map
-- ---------------------------------------------------------------------------
-- Why this exists, since it is plainly a denormalisation of profiles:
--
-- An RLS policy on `profiles` that needs "is this row in MY circle?" must look up the
-- reader's own circle — from `profiles`. That is infinite recursion, and Postgres reports
-- it as a bare "infinite recursion detected in policy for relation profiles" with no clue
-- as to which policy.
--
-- Reading it from a separate table in `app` breaks the cycle by construction rather than
-- by cleverness. `app` is not exposed through PostgREST and is granted to nobody, so this
-- table is unreachable with an anon key; it is kept in step by trigger, never by hand.
create table if not exists app.circle_membership (
  profile_id uuid primary key,
  circle_id uuid not null,
  role public.member_role not null
);

create index if not exists circle_membership_circle_idx on app.circle_membership (circle_id);

create or replace function app.sync_circle_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from app.circle_membership where profile_id = old.id;
    return old;
  end if;

  insert into app.circle_membership (profile_id, circle_id, role)
  values (new.id, new.circle_id, new.role)
  on conflict (profile_id) do update
    set circle_id = excluded.circle_id,
        role = excluded.role;
  return new;
end
$$;

drop trigger if exists profiles_sync_membership on public.profiles;
create trigger profiles_sync_membership
  after insert or update of circle_id, role or delete on public.profiles
  for each row execute function app.sync_circle_membership();

-- ---------------------------------------------------------------------------
-- The predicates RLS policies are built from
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so they can read app.circle_membership, which the `authenticated`
-- role cannot reach. `search_path = ''` is pinned so a caller cannot shadow a table name
-- and change what the function reads — a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation primitive, not a helper.
create or replace function app.current_circle_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select circle_id from app.circle_membership where profile_id = auth.uid()
$$;

create or replace function app.is_mentor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'mentor' from app.circle_membership where profile_id = auth.uid()),
    false
  )
$$;

comment on function app.current_circle_id() is
  'The calling member''s circle, read from app.circle_membership rather than from '
  'public.profiles so that policies ON profiles cannot recurse.';

-- ---------------------------------------------------------------------------
-- Signup: two triggers, opposite failure rules
-- ---------------------------------------------------------------------------
-- These are deliberately two triggers and not one. They have opposite obligations:
--
--   * The invite check MUST raise. An uninvited address must not get an account.
--   * Profile creation must NEVER raise. A missing profile is recoverable; an
--     uncreatable auth user is not, and GoTrue surfaces any exception from this path as
--     an opaque "Database error saving new user" that tells the person nothing and
--     reports "already registered" on retry.
--
-- Putting the blocking check inside the swallowing trigger would enforce nothing.

create or replace function app.enforce_invite_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation_id uuid;
begin
  select id into v_invitation_id
    from public.invitations
   where email = lower(new.email)
     and accepted_at is null
     and expires_at > now()
   limit 1;

  if v_invitation_id is null then
    -- 42501 (insufficient_privilege) rather than a generic error: the outbox classifies
    -- failures by SQLSTATE, and this must read as permanent so it is surfaced to the
    -- person instead of retried forever in silence (§3.10).
    raise exception 'signup_requires_invitation'
      using errcode = '42501',
            hint = 'This address has no live invitation. Ask the mentor for one.';
  end if;

  return new;
end
$$;

comment on function app.enforce_invite_only() is
  'BEFORE INSERT on auth.users. RAISES by design — this is the only thing standing '
  'between a public signup form and the circle. Never merge with the AFTER INSERT '
  'trigger, which must never raise.';

drop trigger if exists auth_users_enforce_invite on auth.users;
create trigger auth_users_enforce_invite
  before insert on auth.users
  for each row execute function app.enforce_invite_only();

create or replace function app.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_display_name text;
  v_timezone text;
begin
  select * into v_invitation
    from public.invitations
   where email = lower(new.email)
     and accepted_at is null
     and expires_at > now()
   limit 1;

  if v_invitation.id is null then
    -- Cannot happen while the BEFORE trigger is installed. If it does, the BEFORE
    -- trigger has been dropped — which is a much bigger problem, and one that a WARNING
    -- in the Postgres log records without also making the account uncreatable.
    raise warning 'create_profile_for_new_user: no invitation for %, profile not created', new.email;
    return new;
  end if;

  v_display_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_timezone := nullif(trim(coalesce(new.raw_user_meta_data ->> 'timezone', '')), '');

  insert into public.profiles (id, circle_id, display_name, timezone, role)
  values (
    new.id,
    v_invitation.circle_id,
    coalesce(v_display_name, split_part(new.email, '@', 1)),
    case when app.is_valid_timezone(v_timezone) then v_timezone else 'UTC' end,
    v_invitation.role
  )
  on conflict (id) do nothing;

  update public.invitations
     set accepted_at = now()
   where id = v_invitation.id;

  return new;
exception
  when others then
    -- The whole point. A failure here must not make the auth user uncreatable; the
    -- orphaned-profile case is detectable and fixable (see docs/RUNBOOK.md), whereas an
    -- account that cannot be created leaves the person with no way forward at all.
    raise warning 'create_profile_for_new_user failed for %: % (%)', new.email, sqlerrm, sqlstate;
    return new;
end
$$;

comment on function app.create_profile_for_new_user() is
  'AFTER INSERT on auth.users. NEVER raises — the body is wrapped so that a failure '
  'degrades to a missing profile (recoverable) rather than an uncreatable auth user '
  '(not recoverable). See docs/RUNBOOK.md, "Database error saving new user".';

drop trigger if exists auth_users_create_profile on auth.users;
create trigger auth_users_create_profile
  after insert on auth.users
  for each row execute function app.create_profile_for_new_user();

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Every policy is scoped by circle. A verb with no policy is denied, so the absence of
-- an INSERT policy on profiles is the enforcement that profiles are created only by the
-- signup trigger.

-- circles: a member sees his own circle and nothing else.
drop policy if exists circles_select_own on public.circles;
create policy circles_select_own
  on public.circles for select to authenticated
  using (id = app.current_circle_id());

-- profiles: a member sees everyone in his circle — that is the point of a circle. What
-- he sees OF them is constrained by which columns the app selects and, for protocol
-- detail, by Phase 2's visibility rules.
drop policy if exists profiles_select_own_circle on public.profiles;
create policy profiles_select_own_circle
  on public.profiles for select to authenticated
  using (circle_id = app.current_circle_id());

-- A member edits only his own row. Which COLUMNS he may edit is enforced by the
-- column-level grant below, not by this policy: WITH CHECK cannot see OLD, so it cannot
-- express "role must not change" — and a policy that looks like it prevents privilege
-- escalation but does not is worse than an honest column grant.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- invitations: the mentor of the circle, and nobody else. Not the invitee — he has no
-- session yet, and once he does he has no business reading the invitation list.
drop policy if exists invitations_mentor_select on public.invitations;
create policy invitations_mentor_select
  on public.invitations for select to authenticated
  using (circle_id = app.current_circle_id() and app.is_mentor());

drop policy if exists invitations_mentor_insert on public.invitations;
create policy invitations_mentor_insert
  on public.invitations for insert to authenticated
  with check (circle_id = app.current_circle_id() and app.is_mentor());

drop policy if exists invitations_mentor_update on public.invitations;
create policy invitations_mentor_update
  on public.invitations for update to authenticated
  using (circle_id = app.current_circle_id() and app.is_mentor())
  with check (circle_id = app.current_circle_id() and app.is_mentor());

drop policy if exists invitations_mentor_delete on public.invitations;
create policy invitations_mentor_delete
  on public.invitations for delete to authenticated
  using (circle_id = app.current_circle_id() and app.is_mentor());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Nothing to anon. There is no public signup and no anonymous surface.
grant select on public.circles to authenticated;
grant select on public.profiles to authenticated;

-- Column-level UPDATE. This is what actually stops a member promoting himself to mentor
-- or moving himself into another circle: `role` and `circle_id` are simply not in the
-- grant, so the attempt is rejected by the privilege system before any policy runs.
grant update (
  display_name,
  timezone,
  top_g_code,
  command_post_note,
  fortress_protocol,
  disclosure_accepted_at,
  disclosure_version
) on public.profiles to authenticated;

grant select, insert, update, delete on public.invitations to authenticated;

update public.app_meta set schema_version = 2, updated_at = now();
