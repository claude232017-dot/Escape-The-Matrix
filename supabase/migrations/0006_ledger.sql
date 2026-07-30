-- 0006_ledger.sql — Phase 4
--
-- The Ledger: what a man is building, what he did about it today, and what came in.
--
-- The Forge measures discipline. This measures commerce. The correlation between them is the
-- thing nothing off the shelf provides (§0), and it becomes computable the moment both sides have
-- rows on the same dates for the same man — which is what this migration establishes.
--
-- ---------------------------------------------------------------------------
-- The visibility line, drawn the same way as the debrief's
-- ---------------------------------------------------------------------------
-- ADR-013 split the debrief because its two halves had different audiences. The Ledger splits on
-- the same principle:
--
--   * **What he did** — offers made, conversations held, deep work blocks. Effort, and effort is
--     exactly what a circle is for. Circle-readable, like protocol results.
--
--   * **What came in** — amounts. Self and mentor only. A man earning £50 in a column beside one
--     earning £5,000 does not produce accountability; it produces a league table, and a league
--     table is the social feed §1 rules out wearing a different hat. The *counts* are comparable
--     because everyone controls them. Revenue is not, which is the entire reason ADR-003 put
--     leading indicators on the daily entry and left revenue off it.
--
-- Ventures are circle-readable: knowing what a man is building is the premise of the circle.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'venture_status' and typnamespace = 'public'::regnamespace) then
    create type public.venture_status as enum ('active', 'paused', 'closed');
  end if;

  -- Money moves one of two ways. Amounts are always stored **positive**; the direction says what
  -- it is. Signed amounts invite a sign convention that half the queries get backwards.
  if not exists (select 1 from pg_type where typname = 'money_direction' and typnamespace = 'public'::regnamespace) then
    create type public.money_direction as enum ('in', 'out');
  end if;

  if not exists (select 1 from pg_type where typname = 'money_category' and typnamespace = 'public'::regnamespace) then
    create type public.money_category as enum (
      'sale', 'recurring', 'refund', 'advertising', 'tooling', 'contractor', 'other'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- ventures
-- ---------------------------------------------------------------------------
create table if not exists public.ventures (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null constraint ventures_name_length check (char_length(name) between 1 and 60),
  -- What kind of thing it is, in his words. Not an enum: the circle's businesses are not a
  -- taxonomy anyone can enumerate in advance, and a wrong enum would force men to misfile.
  kind app.capped_text_140,
  status public.venture_status not null default 'active',
  started_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ventures_name_unique_per_owner unique (owner_id, name)
);

alter table public.ventures enable row level security;
alter table public.ventures force row level security;
create index if not exists ventures_owner_idx on public.ventures (owner_id);

drop trigger if exists ventures_touch_updated_at on public.ventures;
create trigger ventures_touch_updated_at
  before update on public.ventures
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- business_actions — the leading indicators, as editable data
-- ---------------------------------------------------------------------------
-- A seeded catalogue rather than an enum, so the owner can revise the list without a deploy —
-- the same treatment protocols get. ADR-003 fixes the six and leaves a seventh slot empty on
-- purpose: seven is the ceiling, and six leaves room to learn what is missing rather than
-- guessing now.
create table if not exists public.business_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  slug text not null constraint business_actions_slug_shape check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  label text not null constraint business_actions_label_length check (char_length(label) between 1 and 60),
  -- What one unit is, said plainly, because "4" means nothing without it.
  unit text not null default 'count'
    constraint business_actions_unit_length check (char_length(unit) between 1 and 24),
  hint app.capped_text_140,
  sort_order integer not null default 0,
  -- Retired rather than deleted: a past day's entries must stay readable under the list that was
  -- live when it was filed.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint business_actions_slug_unique_per_circle unique (circle_id, slug)
);

alter table public.business_actions enable row level security;
alter table public.business_actions force row level security;

-- ADR-003's ceiling, enforced rather than documented. Seven is the point at which the daily
-- entry stops being fillable one-handed in under a minute, which is criterion 5 on the list that
-- chose these six.
create or replace function app.enforce_business_action_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.business_actions
     where circle_id = new.circle_id and is_active
  ) > 7 then
    raise exception 'business_actions_ceiling'
      using errcode = '23514',
            hint = 'Seven active actions is the ceiling. Retire one before adding another.';
  end if;
  return null;
end
$$;

drop trigger if exists business_actions_ceiling on public.business_actions;
create constraint trigger business_actions_ceiling
  after insert or update of circle_id, is_active on public.business_actions
  deferrable initially immediate
  for each row execute function app.enforce_business_action_ceiling();

-- ---------------------------------------------------------------------------
-- daily_business_entries — what he did today
-- ---------------------------------------------------------------------------
create table if not exists public.daily_business_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- Resolved in his timezone before it arrives, exactly like sitreps.local_date. This column is
  -- what makes the Phase 6 correlation possible: a Forge day and a Ledger day have to be the same
  -- day, and they are only the same day if both were resolved in the same man's zone.
  local_date date not null,
  venture_id uuid not null references public.ventures (id) on delete cascade,
  action_id uuid not null references public.business_actions (id) on delete cascade,
  -- A count, never a tick. "Sent 4 offers" says something "did outreach ✓" does not — ticks
  -- measure obedience, counts measure volume (ADR-003).
  count integer not null default 0
    constraint daily_business_entries_count_sane check (count between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Also the outbox coalescing key: ten edits to one day produce one queued upsert.
  constraint daily_business_entries_one_per_day
    unique (profile_id, local_date, venture_id, action_id)
);

alter table public.daily_business_entries enable row level security;
alter table public.daily_business_entries force row level security;
create index if not exists daily_business_entries_date_idx
  on public.daily_business_entries (profile_id, local_date);

drop trigger if exists daily_business_entries_touch_updated_at on public.daily_business_entries;
create trigger daily_business_entries_touch_updated_at
  before update on public.daily_business_entries
  for each row execute function app.touch_updated_at();

-- The dates a man may file against, and whose venture it is.
create or replace function app.validate_business_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The future is not reportable. Same rule as the SITREP, and for the same reason: without it a
  -- man can post a month of activity this afternoon and the dataset becomes fiction.
  if new.local_date > app.today_for(new.profile_id) then
    raise exception 'business_entry_in_future'
      using errcode = '23514',
            hint = 'You cannot record work for a day you have not lived yet.';
  end if;

  if not exists (
    select 1 from public.ventures v where v.id = new.venture_id and v.owner_id = new.profile_id
  ) then
    raise exception 'business_entry_venture_not_yours'
      using errcode = '42501',
            hint = 'That venture belongs to another member.';
  end if;

  return new;
end
$$;

drop trigger if exists daily_business_entries_validate on public.daily_business_entries;
create trigger daily_business_entries_validate
  before insert or update of local_date, venture_id, profile_id on public.daily_business_entries
  for each row execute function app.validate_business_entry();

-- ---------------------------------------------------------------------------
-- money_entries — what came in, and what went out
-- ---------------------------------------------------------------------------
create table if not exists public.money_entries (
  -- Client-generated, so the outbox can retry an ambiguous failure without booking the same
  -- payment twice. A server-generated id would make every retry a new row.
  id uuid primary key,
  venture_id uuid not null references public.ventures (id) on delete cascade,
  occurred_on date not null,
  direction public.money_direction not null,
  -- §3.2: integer minor units, never a float, at any layer. bigint because a float would silently
  -- lose pennies and nobody would notice until a year-end total was wrong by an amount nobody
  -- could account for. Mirror note: src/lib/money.ts is the only sanctioned way to construct
  -- or format one of these.
  amount_minor bigint not null
    constraint money_entries_amount_positive check (amount_minor > 0),
  currency app.currency_code not null,
  category public.money_category not null default 'sale',
  is_recurring boolean not null default false,
  note app.capped_text_140,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.money_entries enable row level security;
alter table public.money_entries force row level security;
create index if not exists money_entries_venture_idx on public.money_entries (venture_id, occurred_on);

drop trigger if exists money_entries_touch_updated_at on public.money_entries;
create trigger money_entries_touch_updated_at
  before update on public.money_entries
  for each row execute function app.touch_updated_at();

create or replace function app.validate_money_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select owner_id into v_owner from public.ventures where id = new.venture_id;
  if v_owner is null then
    raise exception 'money_venture_missing' using errcode = '23503';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'money_venture_not_yours'
      using errcode = '42501',
            hint = 'That venture belongs to another member.';
  end if;
  if new.occurred_on > app.today_for(v_owner) then
    raise exception 'money_in_future'
      using errcode = '23514',
            hint = 'You cannot record money for a day you have not lived yet.';
  end if;
  return new;
end
$$;

drop trigger if exists money_entries_validate on public.money_entries;
create trigger money_entries_validate
  before insert or update of venture_id, occurred_on on public.money_entries
  for each row execute function app.validate_money_entry();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

drop policy if exists ventures_select_own_circle on public.ventures;
create policy ventures_select_own_circle on public.ventures
  for select to authenticated using (app.shares_my_circle(ventures.owner_id));

drop policy if exists ventures_write_self on public.ventures;
create policy ventures_write_self on public.ventures
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists business_actions_select_own_circle on public.business_actions;
create policy business_actions_select_own_circle on public.business_actions
  for select to authenticated using (circle_id = app.current_circle_id());

drop policy if exists business_actions_mentor_write on public.business_actions;
create policy business_actions_mentor_write on public.business_actions
  for all to authenticated
  using (circle_id = app.current_circle_id() and app.is_mentor())
  with check (circle_id = app.current_circle_id() and app.is_mentor());

-- Effort is circle-readable. This is the accountability half of the Ledger.
drop policy if exists business_entries_select_own_circle on public.daily_business_entries;
create policy business_entries_select_own_circle on public.daily_business_entries
  for select to authenticated using (app.shares_my_circle(daily_business_entries.profile_id));

drop policy if exists business_entries_write_self on public.daily_business_entries;
create policy business_entries_write_self on public.daily_business_entries
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Amounts are not. Self and mentor only — see the header.
drop policy if exists money_entries_select_scoped on public.money_entries;
create policy money_entries_select_scoped on public.money_entries
  for select to authenticated
  using (exists (
    select 1 from public.ventures v
     where v.id = money_entries.venture_id
       and (
         v.owner_id = auth.uid()
         or (app.is_mentor() and app.shares_my_circle(v.owner_id))
       )
  ));

drop policy if exists money_entries_write_self on public.money_entries;
create policy money_entries_write_self on public.money_entries
  for all to authenticated
  using (exists (
    select 1 from public.ventures v where v.id = money_entries.venture_id and v.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.ventures v where v.id = money_entries.venture_id and v.owner_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.ventures to authenticated;
grant select, insert, update, delete on public.business_actions to authenticated;
grant select, insert, update, delete on public.daily_business_entries to authenticated;
grant select, insert, update, delete on public.money_entries to authenticated;

-- ---------------------------------------------------------------------------
-- public.file_business_day
-- ---------------------------------------------------------------------------
-- One venture's counts for one day, in one call. Idempotent, so the outbox may retry it.
-- SECURITY INVOKER, so every policy above still applies — see ADR-012.
create or replace function public.file_business_day(
  p_venture_id uuid,
  p_local_date date,
  p_counts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_written integer;
begin
  if not exists (
    select 1 from public.ventures v where v.id = p_venture_id and v.owner_id = auth.uid()
  ) then
    raise exception 'business_venture_not_yours'
      using errcode = '42501',
            hint = 'You can only record work against your own venture.';
  end if;

  -- Upsert rather than delete-then-insert: unlike protocol results, an absent action means "not
  -- recorded" rather than "changed to zero", and a man who fills in one number should not have
  -- the other five wiped by the write.
  insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
  select auth.uid(), p_local_date, p_venture_id, (entry->>'action_id')::uuid, (entry->>'count')::integer
    from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) as entry
  on conflict (profile_id, local_date, venture_id, action_id)
    do update set count = excluded.count;

  get diagnostics v_written = row_count;
  return jsonb_build_object('written', v_written, 'local_date', p_local_date);
end
$$;

comment on function public.file_business_day(uuid, date, jsonb) is
  'Records one venture''s leading-indicator counts for one day. Idempotent, so the outbox may '
  'retry it. SECURITY INVOKER, so every RLS policy still applies.';

revoke all on function public.file_business_day(uuid, date, jsonb) from public;
revoke all on function public.file_business_day(uuid, date, jsonb) from anon;
grant execute on function public.file_business_day(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The seeded action catalogue
-- ---------------------------------------------------------------------------
-- ADR-003's six, verbatim, with the reasoning kept in the ADR rather than duplicated here.
create or replace function app.seed_business_actions_for_circle(p_circle_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.business_actions (circle_id, slug, label, unit, hint, sort_order)
  values
    (p_circle_id, 'offers-made', 'Offers made', 'offers',
     'A specific ask for money for a specific thing. Not outreach, not a pitch.', 10),
    (p_circle_id, 'conversations-held', 'Conversations held', 'conversations',
     'A real two-way exchange with a potential buyer or partner.', 20),
    (p_circle_id, 'follow-ups-sent', 'Follow-ups sent', 'follow-ups',
     'Most revenue is in the follow-up. It loses to new outreach unless it has its own line.', 30),
    (p_circle_id, 'deep-work-blocks', 'Deep work blocks', '25-min blocks',
     'The Deep Work protocol, counted. The bridge between the Forge and the Ledger.', 40),
    (p_circle_id, 'assets-shipped', 'Assets shipped', 'assets',
     'Something published and finished that persists: a page, a video, software, an offer.', 50),
    (p_circle_id, 'payments-collected', 'Payments collected', 'payments',
     'The event, not the amount. Invoicing and chasing are themselves avoided actions.', 60)
  on conflict (circle_id, slug) do nothing;

  select count(*) into v_count from public.business_actions where circle_id = p_circle_id;
  return v_count;
end
$$;

comment on function app.seed_business_actions_for_circle(uuid) is
  'Seeds ADR-003''s six leading indicators into a circle. Idempotent. The rows are then the '
  'mentor''s to edit — this only provides the starting point.';

update public.app_meta set schema_version = 6, updated_at = now() where id;
