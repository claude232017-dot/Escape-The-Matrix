-- 0003_forge.sql — Phase 2
--
-- Campaigns, protocols, the minimum effective dose, and the daily SITREP.
--
-- The rules themselves live in src/features/forge/doctrine.ts and docs/DOCTRINE.md. What is
-- here is the storage and the integrity constraints — specifically the ones a client cannot be
-- trusted with, because the anon key is public: which dates a man may file against, and where
-- a campaign day count may start from.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'protocol_kind' and typnamespace = 'public'::regnamespace) then
    create type public.protocol_kind as enum ('duty', 'prohibition');
  end if;
  if not exists (select 1 from pg_type where typname = 'protocol_category' and typnamespace = 'public'::regnamespace) then
    create type public.protocol_category as enum ('physical', 'digital', 'nutrition', 'sexual', 'work', 'substance');
  end if;
  -- Sensitive protocols count toward the day's status, which the circle sees, but are not
  -- itemised to peers. The mentor sees everything, disclosed at enrollment — see ADR-009.
  if not exists (select 1 from pg_type where typname = 'protocol_visibility' and typnamespace = 'public'::regnamespace) then
    create type public.protocol_visibility as enum ('itemised', 'aggregate_only');
  end if;
  if not exists (select 1 from pg_type where typname = 'protocol_result_status' and typnamespace = 'public'::regnamespace) then
    create type public.protocol_result_status as enum ('pass', 'med_pass', 'fail');
  end if;
  if not exists (select 1 from pg_type where typname = 'sitrep_status' and typnamespace = 'public'::regnamespace) then
    create type public.sitrep_status as enum ('complete', 'repeat', 'reset');
  end if;
  if not exists (select 1 from pg_type where typname = 'enrollment_status' and typnamespace = 'public'::regnamespace) then
    create type public.enrollment_status as enum ('active', 'reset', 'completed', 'withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'reset_kind' and typnamespace = 'public'::regnamespace) then
    create type public.reset_kind as enum ('treason', 'zero_day');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- app.today_for — the member's own today, resolved server-side
-- ---------------------------------------------------------------------------
-- The client cannot be trusted to say what day it is for itself: that is how a man files
-- yesterday's SITREP tomorrow, or backdates a week of perfect days. The server derives it from
-- `profiles.timezone`, which is the same value getLocalDateString(tz) uses on the client.
--
-- Mirror note: src/lib/date.ts getLocalDateString() is the client-side counterpart. They must
-- agree, and they do because both resolve the same IANA zone from the same column. The body is
-- also inlined once more, in public.start_campaign_enrollment() in 0004_file_sitrep.sql — that
-- function is SECURITY INVOKER and so cannot look up a name in the app schema. Change one, change
-- all three.
create or replace function app.today_for(profile uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = profile),
    'UTC'
  ))::date
$$;

comment on function app.today_for(uuid) is
  'The calendar date it currently is for this member, in his own timezone. Used by the SITREP '
  'insert policy so a client cannot choose which day it is filing against.';

-- ---------------------------------------------------------------------------
-- app.shares_my_circle — the predicate every circle-scoped policy must use
-- ---------------------------------------------------------------------------
-- A policy CANNOT read app.circle_membership directly. A policy expression is evaluated as the
-- querying role — `authenticated` — which has no USAGE on the `app` schema, so an inline
-- `select ... from app.circle_membership` fails with "permission denied" on every query that
-- policy guards.
--
-- This is the trap in ADR-011 seen from the other side: the membership map is deliberately
-- unreachable with a public key, so anything needing it must go through a SECURITY DEFINER
-- function. Found by tests/db/forge-rls.test.ts — the policies read as entirely correct, and
-- eleven of them were broken.
create or replace function app.shares_my_circle(other_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from app.circle_membership mine
      join app.circle_membership theirs on theirs.circle_id = mine.circle_id
     where mine.profile_id = auth.uid()
       and theirs.profile_id = other_profile
  )
$$;

comment on function app.shares_my_circle(uuid) is
  'True when the caller and other_profile share a circle. SECURITY DEFINER because a policy '
  'runs as `authenticated`, which cannot reach the app schema.';

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  name text not null constraint campaigns_name_length check (char_length(name) between 1 and 80),
  starts_on date not null,
  length_days integer not null default 30
    constraint campaigns_length_sane check (length_days between 1 and 365),
  -- Versioned alongside docs/DOCTRINE.md so a finished campaign stays readable under the rules
  -- it was actually run under, even after the doctrine is tuned.
  ruleset_version text not null default '2026.07-draft'
    constraint campaigns_ruleset_length check (char_length(ruleset_version) between 1 and 40),
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
create index if not exists campaigns_circle_idx on public.campaigns (circle_id);

-- ---------------------------------------------------------------------------
-- protocols — mentor-editable data, not hardcoded
-- ---------------------------------------------------------------------------
create table if not exists public.protocols (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  slug text not null constraint protocols_slug_shape check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  label text not null constraint protocols_label_length check (char_length(label) between 1 and 80),
  nickname text constraint protocols_nickname_length check (char_length(nickname) <= 60),
  kind public.protocol_kind not null,
  category public.protocol_category not null,
  -- A protocol below its activation day cannot be failed and is not shown. See DOCTRINE §2.0.
  activates_on_day integer not null default 1
    constraint protocols_activation_positive check (activates_on_day >= 1),
  visibility public.protocol_visibility not null default 'itemised',
  is_treason_trigger boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  constraint protocols_slug_unique_per_campaign unique (campaign_id, slug)
);

alter table public.protocols enable row level security;
alter table public.protocols force row level security;

-- ---------------------------------------------------------------------------
-- protocol_med_options
-- ---------------------------------------------------------------------------
-- A separate table because Physical Forging offers a genuine choice of two — 100 push-ups and
-- 200 squats, OR a 20-minute walk. A single text column would flatten that into prose the
-- interface could not present as an either/or, and the app could not record which one he took.
create table if not exists public.protocol_med_options (
  id uuid primary key default extensions.gen_random_uuid(),
  protocol_id uuid not null references public.protocols (id) on delete cascade,
  sort_order integer not null default 0,
  label text not null constraint med_option_label_length check (char_length(label) between 1 and 40),
  body text not null constraint med_option_body_length check (char_length(body) between 1 and 500),

  constraint med_option_unique_order unique (protocol_id, sort_order)
);

alter table public.protocol_med_options enable row level security;
alter table public.protocol_med_options force row level security;

-- ---------------------------------------------------------------------------
-- enrollments — a reset creates a new row; nothing is deleted
-- ---------------------------------------------------------------------------
create table if not exists public.enrollments (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  -- Day 1. The day count is DERIVED from this and never stored, which is what makes "a reset
  -- destroys nothing" true rather than aspirational. See ADR-002.
  started_on date not null,
  status public.enrollment_status not null default 'active',
  previous_enrollment_id uuid references public.enrollments (id) on delete restrict,
  created_at timestamptz not null default now(),

  -- Cannot point at itself, which would make the chain a loop and hang any walk of it.
  constraint enrollments_no_self_reference check (previous_enrollment_id is distinct from id)
);

alter table public.enrollments enable row level security;
alter table public.enrollments force row level security;

-- One live enrollment per man per campaign. Without this a client could open several and pick
-- whichever shows the longest streak.
create unique index if not exists enrollments_one_active_per_campaign
  on public.enrollments (profile_id, campaign_id)
  where status = 'active';

create index if not exists enrollments_profile_idx on public.enrollments (profile_id);

-- The integrity a policy cannot express, because it spans rows.
create or replace function app.validate_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_previous public.enrollments;
begin
  select * into v_campaign from public.campaigns where id = new.campaign_id;
  if v_campaign.id is null then
    raise exception 'enrollment_campaign_missing' using errcode = '23503';
  end if;

  -- An earlier start date means a higher day number and a longer apparent streak. This is the
  -- one direction of forgery that would flatter the member, so it is the one to close.
  if new.started_on < v_campaign.starts_on then
    raise exception 'enrollment_before_campaign_start'
      using errcode = '23514',
            hint = 'An enrollment cannot begin before its campaign does.';
  end if;

  -- Tomorrow is allowed: a reset filed for today starts the next day, so that the treason day
  -- belongs to exactly one enrollment. Anything beyond tomorrow is a client inventing dates.
  if new.started_on > app.today_for(new.profile_id) + 1 then
    raise exception 'enrollment_starts_in_future'
      using errcode = '23514',
            hint = 'An enrollment cannot begin more than one day ahead of the member''s own today.';
  end if;

  if new.previous_enrollment_id is not null then
    select * into v_previous from public.enrollments where id = new.previous_enrollment_id;
    if v_previous.id is null then
      raise exception 'enrollment_previous_missing' using errcode = '23503';
    end if;
    if v_previous.profile_id <> new.profile_id or v_previous.campaign_id <> new.campaign_id then
      raise exception 'enrollment_previous_not_own'
        using errcode = '42501',
              hint = 'A reset must chain from the member''s own enrollment in the same campaign.';
    end if;
    -- Strictly after: a reset moves forward. Equal or earlier would let a man re-point the
    -- chain at an older start date and recover a day count he lost.
    if new.started_on <= v_previous.started_on then
      raise exception 'enrollment_must_move_forward'
        using errcode = '23514',
              hint = 'A reset enrollment must start after the one it replaces.';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists enrollments_validate on public.enrollments;
create trigger enrollments_validate
  before insert or update of started_on, previous_enrollment_id, campaign_id on public.enrollments
  for each row execute function app.validate_enrollment();

-- ---------------------------------------------------------------------------
-- sitreps
-- ---------------------------------------------------------------------------
create table if not exists public.sitreps (
  id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  -- Resolved in the member's timezone before it arrives. Postgres `date` holds no zone, which
  -- is exactly right: the zone question is settled on the way in. Storing timestamptz and
  -- casting here would reintroduce the UTC rollover bug server-side.
  local_date date not null,
  final_status public.sitrep_status not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One SITREP per man per day. Also the outbox coalescing key: ten edits to one day must
  -- produce one upsert, not ten replays.
  constraint sitreps_one_per_day unique (enrollment_id, local_date)
);

alter table public.sitreps enable row level security;
alter table public.sitreps force row level security;
create index if not exists sitreps_date_idx on public.sitreps (local_date);

drop trigger if exists sitreps_touch_updated_at on public.sitreps;
create trigger sitreps_touch_updated_at
  before update on public.sitreps
  for each row execute function app.touch_updated_at();

-- Which dates a man may file against. Spans rows, so it is a trigger rather than a CHECK.
create or replace function app.validate_sitrep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.enrollments;
begin
  select * into v_enrollment from public.enrollments where id = new.enrollment_id;
  if v_enrollment.id is null then
    raise exception 'sitrep_enrollment_missing' using errcode = '23503';
  end if;

  if new.local_date < v_enrollment.started_on then
    raise exception 'sitrep_before_enrollment'
      using errcode = '23514',
            hint = 'That day belongs to an earlier enrollment. Its history is still there.';
  end if;

  -- The future is not reportable. Without this a man can file thirty perfect days this
  -- afternoon, and the dataset the whole product exists to build becomes fiction.
  if new.local_date > app.today_for(v_enrollment.profile_id) then
    raise exception 'sitrep_in_future'
      using errcode = '23514',
            hint = 'You cannot file a report for a day you have not lived yet.';
  end if;

  return new;
end
$$;

drop trigger if exists sitreps_validate on public.sitreps;
create trigger sitreps_validate
  before insert or update of local_date, enrollment_id on public.sitreps
  for each row execute function app.validate_sitrep();

-- ---------------------------------------------------------------------------
-- protocol_results
-- ---------------------------------------------------------------------------
create table if not exists public.protocol_results (
  id uuid primary key default extensions.gen_random_uuid(),
  sitrep_id uuid not null references public.sitreps (id) on delete cascade,
  protocol_id uuid not null references public.protocols (id) on delete cascade,
  status public.protocol_result_status not null,
  -- Which alternative he used. Only meaningful for a MED pass.
  med_option_id uuid references public.protocol_med_options (id) on delete set null,

  constraint protocol_results_one_per_protocol unique (sitrep_id, protocol_id),
  -- A pass or a fail cannot name a MED option: that would record him doing the minimum on a
  -- day he did the full thing, and the distinction is the whole point of storing it.
  constraint protocol_results_med_option_only_for_med_pass check (
    med_option_id is null or status = 'med_pass'
  )
);

alter table public.protocol_results enable row level security;
alter table public.protocol_results force row level security;
create index if not exists protocol_results_sitrep_idx on public.protocol_results (sitrep_id);

-- ---------------------------------------------------------------------------
-- reset_events
-- ---------------------------------------------------------------------------
-- A reset is recorded as a fact, not a verdict — and the reason is captured as data so that
-- patterns in resets become visible in the same way patterns in attacks do. See ADR-002.
create table if not exists public.reset_events (
  id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id) on delete cascade,
  occurred_on date not null,
  kind public.reset_kind not null,
  reason app.capped_text_140,
  -- The slugs that failed, so the event stands alone in analysis without re-deriving it from
  -- protocol_results under a protocol list that may since have been edited.
  protocols_failed text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.reset_events enable row level security;
alter table public.reset_events force row level security;
create index if not exists reset_events_enrollment_idx on public.reset_events (enrollment_id);

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Reading is circle-scoped: the circle sees each other's status, which is the accountability
-- mechanism. Writing is always self-only.

drop policy if exists campaigns_select_own_circle on public.campaigns;
create policy campaigns_select_own_circle on public.campaigns
  for select to authenticated using (circle_id = app.current_circle_id());

drop policy if exists campaigns_mentor_write on public.campaigns;
create policy campaigns_mentor_write on public.campaigns
  for insert to authenticated
  with check (circle_id = app.current_circle_id() and app.is_mentor());

drop policy if exists campaigns_mentor_update on public.campaigns;
create policy campaigns_mentor_update on public.campaigns
  for update to authenticated
  using (circle_id = app.current_circle_id() and app.is_mentor())
  with check (circle_id = app.current_circle_id() and app.is_mentor());

-- Protocols are the mentor's to define and everyone's to read.
drop policy if exists protocols_select_own_circle on public.protocols;
create policy protocols_select_own_circle on public.protocols
  for select to authenticated
  using (exists (
    select 1 from public.campaigns c
     where c.id = protocols.campaign_id and c.circle_id = app.current_circle_id()
  ));

drop policy if exists protocols_mentor_insert on public.protocols;
create policy protocols_mentor_insert on public.protocols
  for insert to authenticated
  with check (app.is_mentor() and exists (
    select 1 from public.campaigns c
     where c.id = protocols.campaign_id and c.circle_id = app.current_circle_id()
  ));

drop policy if exists protocols_mentor_update on public.protocols;
create policy protocols_mentor_update on public.protocols
  for update to authenticated
  using (app.is_mentor() and exists (
    select 1 from public.campaigns c
     where c.id = protocols.campaign_id and c.circle_id = app.current_circle_id()
  ))
  with check (app.is_mentor());

drop policy if exists protocols_mentor_delete on public.protocols;
create policy protocols_mentor_delete on public.protocols
  for delete to authenticated
  using (app.is_mentor() and exists (
    select 1 from public.campaigns c
     where c.id = protocols.campaign_id and c.circle_id = app.current_circle_id()
  ));

drop policy if exists med_options_select_own_circle on public.protocol_med_options;
create policy med_options_select_own_circle on public.protocol_med_options
  for select to authenticated
  using (exists (
    select 1 from public.protocols p join public.campaigns c on c.id = p.campaign_id
     where p.id = protocol_med_options.protocol_id and c.circle_id = app.current_circle_id()
  ));

drop policy if exists med_options_mentor_write on public.protocol_med_options;
create policy med_options_mentor_write on public.protocol_med_options
  for all to authenticated
  using (app.is_mentor() and exists (
    select 1 from public.protocols p join public.campaigns c on c.id = p.campaign_id
     where p.id = protocol_med_options.protocol_id and c.circle_id = app.current_circle_id()
  ))
  with check (app.is_mentor());

-- Enrollments: the circle sees who is on which day. Only the man himself creates his own.
drop policy if exists enrollments_select_own_circle on public.enrollments;
create policy enrollments_select_own_circle on public.enrollments
  for select to authenticated
  using (app.shares_my_circle(enrollments.profile_id));

drop policy if exists enrollments_insert_self on public.enrollments;
create policy enrollments_insert_self on public.enrollments
  for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists enrollments_update_self on public.enrollments;
create policy enrollments_update_self on public.enrollments
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- SITREPs: circle-readable, self-writable. What the circle sees of another man is his status,
-- not his itemised protocol detail — that distinction is enforced on protocol_results below.
drop policy if exists sitreps_select_own_circle on public.sitreps;
create policy sitreps_select_own_circle on public.sitreps
  for select to authenticated
  using (exists (
    select 1 from public.enrollments e
     where e.id = sitreps.enrollment_id and app.shares_my_circle(e.profile_id)
  ));

drop policy if exists sitreps_write_self on public.sitreps;
create policy sitreps_write_self on public.sitreps
  for all to authenticated
  using (exists (
    select 1 from public.enrollments e
     where e.id = sitreps.enrollment_id and e.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.enrollments e
     where e.id = sitreps.enrollment_id and e.profile_id = auth.uid()
  ));

-- protocol_results is where §3.5 bites. A peer may read a result only if the protocol is
-- `itemised`; the sensitive ones contribute to the day's status and stop there. The member
-- himself and the mentor see everything — the mentor's access disclosed at enrollment (ADR-009).
drop policy if exists protocol_results_select_scoped on public.protocol_results;
create policy protocol_results_select_scoped on public.protocol_results
  for select to authenticated
  using (
    exists (
      select 1
        from public.sitreps s
        join public.enrollments e on e.id = s.enrollment_id
       where s.id = protocol_results.sitrep_id
         and (
           -- his own
           e.profile_id = auth.uid()
           -- or the mentor of his circle
           or (app.is_mentor() and app.shares_my_circle(e.profile_id))
           -- or a peer, but only for a protocol marked itemised
           or (app.shares_my_circle(e.profile_id) and exists (
             select 1 from public.protocols p
              where p.id = protocol_results.protocol_id and p.visibility = 'itemised'
           ))
         )
    )
  );

drop policy if exists protocol_results_write_self on public.protocol_results;
create policy protocol_results_write_self on public.protocol_results
  for all to authenticated
  using (exists (
    select 1 from public.sitreps s join public.enrollments e on e.id = s.enrollment_id
     where s.id = protocol_results.sitrep_id and e.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sitreps s join public.enrollments e on e.id = s.enrollment_id
     where s.id = protocol_results.sitrep_id and e.profile_id = auth.uid()
  ));

-- Reset events: his own and the mentor's to read. Not peers' — a reset is a fact, but whose
-- fact it is to share is his.
drop policy if exists reset_events_select_scoped on public.reset_events;
create policy reset_events_select_scoped on public.reset_events
  for select to authenticated
  using (exists (
    select 1 from public.enrollments e
     where e.id = reset_events.enrollment_id
       and (
         e.profile_id = auth.uid()
         or (app.is_mentor() and app.shares_my_circle(e.profile_id))
       )
  ));

drop policy if exists reset_events_insert_self on public.reset_events;
create policy reset_events_insert_self on public.reset_events
  for insert to authenticated
  with check (exists (
    select 1 from public.enrollments e
     where e.id = reset_events.enrollment_id and e.profile_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.protocols to authenticated;
grant select, insert, update, delete on public.protocol_med_options to authenticated;
grant select, insert, update on public.enrollments to authenticated;
-- No DELETE on enrollments: history is never destroyed, and the absence of the grant is what
-- makes that structural rather than a convention. Same for sitreps and reset_events.
grant select, insert, update on public.sitreps to authenticated;
grant select, insert, update, delete on public.protocol_results to authenticated;
grant select, insert on public.reset_events to authenticated;

-- ---------------------------------------------------------------------------
-- The seeded protocol catalogue
-- ---------------------------------------------------------------------------
-- A function rather than static rows, because protocols belong to a campaign and each campaign
-- gets its own editable copy. The mentor can then change one campaign's ruleset without
-- rewriting history for a finished one.
--
-- Activation days per docs/DOCTRINE.md §2.0, settled by the owner 2026-07-30: five waves at
-- days 1, 4, 8, 15 and 22.
create or replace function app.seed_protocols_for_campaign(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
  v_protocol_id uuid;
begin
  -- Duties -----------------------------------------------------------------
  insert into public.protocols
    (campaign_id, slug, label, nickname, kind, category, activates_on_day, visibility, is_treason_trigger, sort_order)
  values
    (p_campaign_id, 'morning-protocol', 'Morning Protocol', 'The 5-Minute Victory',
     'duty', 'physical', 1, 'itemised', false, 10),
    (p_campaign_id, 'daily-sitrep', 'The SITREP', null,
     'duty', 'work', 1, 'itemised', false, 20),
    (p_campaign_id, 'physical-forging', 'Physical Forging', null,
     'duty', 'physical', 4, 'itemised', false, 30),
    (p_campaign_id, 'deep-work', 'Deep Work', 'The 25-Minute Sprint',
     'duty', 'work', 4, 'itemised', false, 40),
    (p_campaign_id, 'evening-power-down', 'Evening Power-Down', 'The 15-Minute Shutdown',
     'duty', 'digital', 15, 'itemised', false, 50)
  on conflict (campaign_id, slug) do nothing;

  -- Prohibitions ------------------------------------------------------------
  -- The two `aggregate_only` entries are the §3.5 defaults: they count toward the day's status,
  -- which the circle sees, but are not itemised to peers. The sexual-discipline oath is also
  -- the sole treason trigger.
  insert into public.protocols
    (campaign_id, slug, label, nickname, kind, category, activates_on_day, visibility, is_treason_trigger, sort_order)
  values
    (p_campaign_id, 'sexual-discipline', 'Sexual discipline', null,
     'prohibition', 'sexual', 1, 'aggregate_only', true, 60),
    (p_campaign_id, 'video-games', 'Video games', null,
     'prohibition', 'digital', 1, 'itemised', false, 70),
    (p_campaign_id, 'junk-food', 'Junk food', null,
     'prohibition', 'nutrition', 8, 'itemised', false, 80),
    (p_campaign_id, 'alcohol-and-drugs', 'Alcohol and recreational drugs', null,
     'prohibition', 'substance', 8, 'aggregate_only', false, 90),
    (p_campaign_id, 'binge-watching', 'Binge-watching', null,
     'prohibition', 'digital', 15, 'itemised', false, 100),
    (p_campaign_id, 'mindless-scrolling', 'Mindless social media and news', null,
     'prohibition', 'digital', 22, 'itemised', false, 110)
  on conflict (campaign_id, slug) do nothing;

  select count(*) into v_inserted from public.protocols where campaign_id = p_campaign_id;

  -- MED options -------------------------------------------------------------
  -- Physical Forging is the reason protocol_med_options exists: a genuine either/or, which a
  -- single text column could not express and the UI could not present as a choice.
  select id into v_protocol_id from public.protocols
   where campaign_id = p_campaign_id and slug = 'physical-forging';
  if v_protocol_id is not null then
    insert into public.protocol_med_options (protocol_id, sort_order, label, body) values
      (v_protocol_id, 1, 'Option A',
       '100 push-ups and 200 bodyweight squats. May be broken up across the day.'),
      (v_protocol_id, 2, 'Option B',
       'A 20-minute non-stop run or brisk walk.')
    on conflict (protocol_id, sort_order) do nothing;
  end if;

  select id into v_protocol_id from public.protocols
   where campaign_id = p_campaign_id and slug = 'morning-protocol';
  if v_protocol_id is not null then
    insert into public.protocol_med_options (protocol_id, sort_order, label, body) values
      (v_protocol_id, 1, 'The 5-Minute Victory',
       'Go to the Command Post, drink one full glass of water, read the Top G Code aloud, perform 20 push-ups.')
    on conflict (protocol_id, sort_order) do nothing;
  end if;

  select id into v_protocol_id from public.protocols
   where campaign_id = p_campaign_id and slug = 'deep-work';
  if v_protocol_id is not null then
    insert into public.protocol_med_options (protocol_id, sort_order, label, body) values
      (v_protocol_id, 1, 'The 25-Minute Sprint',
       'One 25-minute completely uninterrupted Pomodoro on the most important task, under Fortress Protocol rules.')
    on conflict (protocol_id, sort_order) do nothing;
  end if;

  select id into v_protocol_id from public.protocols
   where campaign_id = p_campaign_id and slug = 'evening-power-down';
  if v_protocol_id is not null then
    insert into public.protocol_med_options (protocol_id, sort_order, label, body) values
      (v_protocol_id, 1, 'The 15-Minute Shutdown',
       'Digital Sunset — all screens off — is non-negotiable. At minimum 15 minutes with a physical book before sleep.')
    on conflict (protocol_id, sort_order) do nothing;
  end if;

  return v_inserted;
end
$$;

comment on function app.seed_protocols_for_campaign(uuid) is
  'Seeds the standard protocol catalogue and MED options into a campaign. Idempotent. The rows '
  'are then the mentor''s to edit — this only provides the starting point, per DOCTRINE §2.';

update public.app_meta set schema_version = 3, updated_at = now() where id;
