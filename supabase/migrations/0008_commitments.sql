-- 0008_commitments.sql — Phase 5
--
-- The weekly loop. DOCTRINE §8.
--
-- ---------------------------------------------------------------------------
-- The week hangs off the member, not off the circle
-- ---------------------------------------------------------------------------
-- §8 settles two things that together decide this whole schema: the week runs Monday to Sunday,
-- and its boundaries are computed in **each member's own timezone**. So there is no shared
-- `weeks` table and no circle-wide week row — Auckland crosses into Monday about twenty-one hours
-- before Los Angeles, and one boundary would be wrong for at least one of them. `week_start` is a
-- plain date on the member's own row, resolved the way `sitreps.local_date` is.
--
-- ---------------------------------------------------------------------------
-- The one place §8 needed reading rather than quoting
-- ---------------------------------------------------------------------------
-- §8 says both *"declare Monday, settle Sunday"* and *"a commitment cannot be edited once the
-- week has started"*. Taken literally together those contradict: the week starts at Monday 00:00,
-- so there is no moment at which anything could be declared at all.
--
-- Resolved by making the rule **stronger** than either sentence rather than picking between them:
--
--   * a commitment is **immutable from the instant it is written**. Not frozen on Tuesday —
--     never editable. "Declaring is committing" is the stated mechanism, and a body that can be
--     revised on Thursday in the light of how the week is actually going has committed to
--     nothing. The revision would also be invisible: the row would read as though he had meant
--     that all along.
--   * it may only be declared **for the week he is currently in**, so he cannot back-date a
--     commitment into a week that has already been judged, or park one in a future week to edit
--     later.
--   * `declared_on` records which day he actually declared it. Monday is the ritual and the
--     screen says so, but a man who joins the circle on a Wednesday can still commit to
--     something, and a man who declares on Friday has that fact recorded rather than hidden.
--
-- A hard Monday-only gate was written first and rejected for two reasons: it makes the feature
-- unusable six days in seven for anyone joining mid-week, and it makes its own happy path
-- untestable six days in seven, which is how a rule ends up asserted rather than verified.
--
-- Recorded in DOCTRINE §10 for the owner. If he wants the hard gate it is the insert policy and
-- one predicate in commitment-draft.ts, and nothing else.
--
-- ---------------------------------------------------------------------------
-- Who can see it
-- ---------------------------------------------------------------------------
-- Circle-readable, and that is not a judgement made here: the enrollment disclosure the member
-- accepted says in as many words that the other men see *"your weekly commitments and whether
-- you hit them"*. Changing it would mean changing what he was told, which means a new disclosure
-- version. See src/features/auth/components/DisclosureBody.tsx.
--
-- It is also the point of the feature. A commitment nobody else can see is a note to self, and
-- §9 rules out a private journal.

-- ---------------------------------------------------------------------------
-- app.week_start_for — the Monday of this member's current week
-- ---------------------------------------------------------------------------
-- Mirror note: startOfWeek() in src/lib/date.ts, over getLocalDateString(). Both must answer with
-- the same Monday for the same member at the same instant, and both derive it from an
-- already-zone-resolved calendar date rather than from an instant — see §3.1.
--
-- `date_trunc('week', …)` is ISO-8601 and therefore Monday-based, which is why DOCTRINE §8
-- settled on Monday: the boundary is one expression composed with app.today_for(), with no offset
-- arithmetic to keep in step between the two languages.
create or replace function app.week_start_for(profile uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('week', app.today_for(profile)::timestamp)::date
$$;

comment on function app.week_start_for(uuid) is
  'The Monday of the week this member is currently living, in his own timezone. Mirror: '
  'startOfWeek() in src/lib/date.ts.';

-- ---------------------------------------------------------------------------
-- The outcome of a commitment
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'commitment_outcome') then
    create type public.commitment_outcome as enum ('pending', 'hit', 'missed');
  end if;
end
$$;

comment on type public.commitment_outcome is
  'Three states, and `pending` is one of them on purpose: an unresolved commitment is a fact '
  'about the week, not a missing value. DOCTRINE §8 — a weekly review cannot be submitted while '
  'any commitment is still pending, which is only expressible if pending is a value.';

-- ---------------------------------------------------------------------------
-- commitments
-- ---------------------------------------------------------------------------
create table if not exists public.commitments (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  -- The Monday. Constrained to actually be one, because every window rule below is arithmetic on
  -- this column and a Wednesday here would silently shift all of them.
  week_start date not null,
  -- A commitment is a specific claim, not a paragraph. ADR-001.
  body public.capped_text_140 not null,
  outcome public.commitment_outcome not null default 'pending',
  -- The day he actually declared it, in his own timezone. Set by a trigger rather than by the
  -- client, so it cannot be back-dated to look like Monday discipline that did not happen.
  declared_on date not null,
  -- When he settled it. Null while pending; stamped by the trigger, so it records when the
  -- database saw the decision rather than what a phone's clock claimed.
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint commitments_week_start_is_monday
    check (extract(isodow from week_start) = 1),
  constraint commitments_body_not_blank
    check (btrim(body) <> ''),
  -- Declared within the week it belongs to. Belt to the insert policy's braces: the policy stops
  -- a client choosing the week, and this stops any path that ever bypasses it.
  constraint commitments_declared_within_week
    check (declared_on >= week_start and declared_on < week_start + 7),
  -- `resolved_at` and a settled `outcome` are one fact. Both or neither, so no row can claim to
  -- be settled without saying when.
  constraint commitments_resolved_together
    check ((outcome = 'pending') = (resolved_at is null))
);

comment on table public.commitments is
  'Up to three declarations per member per week. DOCTRINE §8. Immutable once written, settled '
  'from Sunday.';

create index if not exists commitments_by_member_week
  on public.commitments (profile_id, week_start);

-- ---------------------------------------------------------------------------
-- Three, by constraint
-- ---------------------------------------------------------------------------
-- §8: "Three is a cap enforced by a database constraint, not a suggestion." A constraint trigger
-- rather than a CHECK because the rule is about the *set* of rows for a member-week, which a
-- row-level CHECK cannot see.
--
-- Mirror note: MAX_COMMITMENTS in src/features/week/commitment-draft.ts gives the fast error.
-- This is what makes the rule true.
create or replace function app.enforce_commitment_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.commitments
     where profile_id = new.profile_id and week_start = new.week_start
  ) > 3 then
    raise exception 'commitments_ceiling'
      using errcode = '23514',
            hint = 'Three commitments in a week is the cap. It is a cap, not a target.';
  end if;
  return null;
end
$$;

drop trigger if exists commitments_ceiling on public.commitments;
create constraint trigger commitments_ceiling
  after insert or update of profile_id, week_start on public.commitments
  deferrable initially immediate
  for each row execute function app.enforce_commitment_ceiling();

-- ---------------------------------------------------------------------------
-- Stamp the day it was declared
-- ---------------------------------------------------------------------------
create or replace function app.stamp_commitment_declared_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Defaulted, not forced. What stops a member claiming he declared on Monday when he declared
  -- on Saturday is the insert policy, which requires `declared_on = app.today_for(profile_id)` —
  -- a rule that belongs in the policy because that is where every other rule about what a member
  -- may write already lives.
  --
  -- Leaving the trigger as a default rather than an overwrite is what lets the owner write a
  -- historical row deliberately: test fixtures for past weeks, and any future backfill. Neither
  -- can reach the client, because the policy still applies to everything the client does.
  new.declared_on := coalesce(new.declared_on, app.today_for(new.profile_id));
  return new;
end
$$;

drop trigger if exists commitments_stamp_declared_on on public.commitments;
create trigger commitments_stamp_declared_on
  before insert on public.commitments
  for each row execute function app.stamp_commitment_declared_on();

-- ---------------------------------------------------------------------------
-- Immutable body; settle from Sunday
-- ---------------------------------------------------------------------------
-- Enforced here rather than in a policy because it is per-column: a policy sees rows, and the
-- rule is about which columns may change.
create or replace function app.enforce_commitment_windows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := app.today_for(old.profile_id);
begin
  if new.body is distinct from old.body
     or new.week_start is distinct from old.week_start
     or new.profile_id is distinct from old.profile_id
     or new.declared_on is distinct from old.declared_on then
    raise exception 'commitment_immutable'
      using errcode = 'P0001',
            hint = 'A commitment cannot be reworded. Declaring is committing.';
  end if;

  if new.outcome is distinct from old.outcome then
    -- Sunday is week_start + 6. Settling opens then and never closes: a man who was away has to
    -- be able to close out an old week, and refusing him would leave a permanently unresolvable
    -- row blocking every weekly review after it.
    if today < old.week_start + 6 then
      raise exception 'commitment_too_early'
        using errcode = 'P0001',
              hint = 'Settle on Sunday. The week is not over yet.';
    end if;
    if new.outcome = 'pending' then
      raise exception 'commitment_already_settled'
        using errcode = 'P0001',
              hint = 'A settled commitment can be corrected, not un-answered.';
    end if;
    -- Stamped here: this is when the database saw the decision.
    new.resolved_at := now();
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists commitments_windows on public.commitments;
create trigger commitments_windows
  before update on public.commitments
  for each row execute function app.enforce_commitment_windows();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.commitments enable row level security;
alter table public.commitments force row level security;

drop policy if exists commitments_select_own_circle on public.commitments;
create policy commitments_select_own_circle on public.commitments
  for select to authenticated using (app.shares_my_circle(commitments.profile_id));

-- His own rows, in the week he is currently living. A client sending last week's Monday to
-- rewrite a judged week, or next week's to declare early and edit later, is refused by the
-- policy rather than by a constraint, so it never reaches a row at all.
drop policy if exists commitments_insert_this_week on public.commitments;
create policy commitments_insert_this_week on public.commitments
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and week_start = app.week_start_for(profile_id)
    and outcome = 'pending'
    -- Today, and only today. A client cannot post-date a commitment to look like Monday
    -- discipline that did not happen.
    and declared_on = app.today_for(profile_id)
  );

-- Updating is his own rows only; *what* may change is the trigger's business.
drop policy if exists commitments_update_self on public.commitments;
create policy commitments_update_self on public.commitments
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Deleting closes on the day it opened. Same-day is a typo escape hatch and the mechanism that
-- makes `declare_commitments` idempotent on retry. From the next day there is no delete, which is
-- what stops a commitment being quietly dropped once the week starts going badly.
drop policy if exists commitments_delete_same_day on public.commitments;
create policy commitments_delete_same_day on public.commitments
  for delete to authenticated
  using (
    profile_id = auth.uid()
    and outcome = 'pending'
    and declared_on = app.today_for(profile_id)
  );

grant select, insert, update, delete on public.commitments to authenticated;

-- ---------------------------------------------------------------------------
-- public.declare_commitments — the whole slate, in one call
-- ---------------------------------------------------------------------------
-- One call for one member-week, so three commitments cannot land as two. Idempotent, because the
-- outbox may retry it (ADR-012): calling it twice with the same list leaves the same rows rather
-- than double.
--
-- SECURITY INVOKER. It runs as the caller, so every policy above still applies — it exists for
-- atomicity, not to escape RLS. In particular the delete below is subject to
-- `commitments_delete_same_day`, so a retry on a later day cannot silently rewrite the slate;
-- it fails on the ceiling instead, which is the correct answer.
create or replace function public.declare_commitments(
  p_week_start date,
  p_bodies text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile uuid := auth.uid();
  v_monday date;
  v_body text;
  v_written int := 0;
begin
  if v_profile is null then
    raise exception 'commitment_no_session' using errcode = '42501';
  end if;

  -- Mirror note: this expression is the body of app.week_start_for() above, and of
  -- startOfWeek(getLocalDateString(tz)) in src/lib/date.ts. It is inlined rather than called
  -- because this function is SECURITY INVOKER: it runs as `authenticated`, which has no USAGE on
  -- the app schema and therefore cannot look a function up in it at execution time. An RLS policy
  -- can call app.* because it stores the OID when the policy is created; a plpgsql body resolves
  -- the name every time it runs. Same trap as ADR-011, different door — see 0004_file_sitrep.sql,
  -- which inlines app.today_for() for exactly this reason.
  select date_trunc('week', ((now() at time zone p.timezone)::date)::timestamp)::date
    into v_monday
    from public.profiles p where p.id = v_profile;

  if v_monday is null then
    raise exception 'profile_missing' using errcode = '23503';
  end if;

  if p_week_start <> v_monday then
    raise exception 'commitment_not_this_week'
      using errcode = 'P0001',
            hint = 'Commitments are declared for the week you are in.';
  end if;

  if coalesce(array_length(p_bodies, 1), 0) > 3 then
    raise exception 'commitments_ceiling'
      using errcode = '23514',
            hint = 'Three commitments in a week is the cap. It is a cap, not a target.';
  end if;

  -- Replace today's declarations rather than merge. "The list is now exactly this" is the only
  -- statement a retry can repeat safely. Rows declared on an earlier day are untouched by the
  -- delete policy and therefore survive — which is intended: they are already committed to.
  delete from public.commitments
   where profile_id = v_profile and week_start = p_week_start;

  foreach v_body in array coalesce(p_bodies, array[]::text[]) loop
    if btrim(v_body) <> '' then
      -- `declared_on` omitted on purpose: the trigger stamps today, and the insert policy
      -- requires it to be today. Passing p_week_start here would have claimed every commitment
      -- was declared on Monday whatever day it actually was.
      insert into public.commitments (profile_id, week_start, body)
      values (v_profile, p_week_start, btrim(v_body)::public.capped_text_140);
      v_written := v_written + 1;
    end if;
  end loop;

  return jsonb_build_object('written', v_written);
end
$$;

revoke all on function public.declare_commitments(date, text[]) from public, anon;
grant execute on function public.declare_commitments(date, text[]) to authenticated;

comment on function public.declare_commitments(date, text[]) is
  'Declare this week''s slate in one call. Three at most, idempotent within the day.';

update public.app_meta set schema_version = 8, updated_at = now() where id;
