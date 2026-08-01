-- 0009_command.sql — Phase 6
--
-- Where the two loops meet.
--
-- ---------------------------------------------------------------------------
-- What this phase is actually for
-- ---------------------------------------------------------------------------
-- ARCHITECTURE states the premise: discipline is the leading indicator, money is the lagging
-- one, and the correlation between them is the one thing nothing off the shelf provides. Every
-- phase so far has been collecting the two halves. This is the join.
--
-- The honest version of that is smaller than it sounds, and saying so here is the point:
--
--   * A thirty-day campaign is **four weeks**. A correlation coefficient over four points is
--     noise with a decimal place on it, and the app already refuses to do this elsewhere — see
--     AttackPatternPanel, which will not name an attack window under five incidents. Weekly
--     revenue is therefore **reported and never correlated**.
--   * A thirty-day campaign is also **thirty days**, and at that grain there is a real question
--     with enough evidence behind it: *on the days he held the line, did he do more of the work
--     that makes money?* That is a difference between two groups of days, not a regression, and
--     ADR-003 already named the metric to test it on — deep work blocks, "the bridge between the
--     Forge and the Ledger".
--
-- So this migration builds the **grain**, not the statistic. One row per member per reported
-- day, with both loops on it. What that grain is allowed to claim lives in
-- src/features/command/correlation.ts, where it can be tested without a database.
--
-- ---------------------------------------------------------------------------
-- Why a view, and why `security_invoker` is load-bearing
-- ---------------------------------------------------------------------------
-- This is the first view in the schema, so the rule is being set here: **every view in `public`
-- is `security_invoker = on`.**
--
-- A view is owned by whoever created it, which here is the migration runner. By default a view
-- executes with the *owner's* privileges, so RLS on the underlying tables is evaluated as the
-- owner and not as the caller — a plain view over `money_entries` would hand every member every
-- other member's revenue, silently, while every policy underneath it remained correct. There is
-- no error, no empty screen, nothing to notice. It simply answers.
--
-- `security_invoker = on` makes the view run as the querying role, so the policies on `sitreps`,
-- `daily_business_entries` and `money_entries` apply exactly as they do to a direct query.
-- Asserted in tests/db/rls-posture.test.ts for every view, not just this one, because the next
-- view will be written by someone who has not read this comment.
--
-- ---------------------------------------------------------------------------
-- public.member_days — the grain
-- ---------------------------------------------------------------------------
-- Built on `sitreps`, which means: **days he reported on**. A day with no SITREP has no status,
-- so it cannot answer "did he hold the line", and inventing a status for it would be inventing
-- data. Business actions recorded on an unreported day are therefore not in this view; they are
-- still in `daily_business_entries`, and the Ledger still shows them.
--
-- Lateral aggregates rather than joins. Joining `daily_business_entries` and `money_entries`
-- directly would fan out — three actions and two payments on one day is six rows, and every
-- count would be wrong by exactly the amount nobody checks.
create or replace view public.member_days
with (security_invoker = on) as
select
  e.profile_id,
  e.id            as enrollment_id,
  s.local_date,
  s.final_status,
  coalesce(work.blocks, 0)::integer      as deep_work_blocks,
  coalesce(work.actions, 0)::integer     as business_actions,
  coalesce(money.revenue_minor, 0)::bigint as revenue_minor,
  money.currency,
  -- More than one currency in a day means the total above is a lie. Reported rather than
  -- silently summed: §3.2 forbids a wrong number about money more strongly than it forbids a
  -- missing one, and the client refuses to display a mixed-currency total.
  coalesce(money.currency_count, 0)::integer as currency_count
from public.sitreps s
join public.enrollments e on e.id = s.enrollment_id
left join lateral (
  select
    sum(d.count) filter (where a.slug = 'deep-work-blocks') as blocks,
    sum(d.count)                                            as actions
  from public.daily_business_entries d
  join public.business_actions a on a.id = d.action_id
  where d.profile_id = e.profile_id and d.local_date = s.local_date
) work on true
left join lateral (
  select
    sum(m.amount_minor)              as revenue_minor,
    min(m.currency)                  as currency,
    count(distinct m.currency)       as currency_count
  from public.money_entries m
  join public.ventures v on v.id = m.venture_id
  where v.owner_id = e.profile_id
    and m.occurred_on = s.local_date
    and m.direction = 'in'
) money on true;

comment on view public.member_days is
  'One row per member per reported day, with both loops on it: the day''s Forge status, the '
  'business actions counted against it, and the revenue booked on it. The grain the Phase 6 '
  'correlation reads. security_invoker = on, so RLS applies as the caller — see 0009 header.';

grant select on public.member_days to authenticated;

-- ---------------------------------------------------------------------------
-- public.weekly_reviews
-- ---------------------------------------------------------------------------
-- DATA-MODEL: "a snapshot of the computed numbers. Not optional: recomputing history from live
-- definitions means a man's past weeks silently change when the mentor edits the protocol list."
--
-- That is the whole reason this table stores numbers rather than deriving them. A protocol added
-- in week three changes what "held the line" means; recomputing week one under week three's
-- catalogue would quietly rewrite a month of a man's history, and he would have no way to know.
-- The snapshot is what was true at the time, and it is written once.
create table if not exists public.weekly_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,

  -- Three structured fields, capped like everything else. ADR-001 — no free-text journal.
  what_worked public.capped_text_140,
  what_did_not public.capped_text_140,
  next_week public.capped_text_140,

  -- What the numbers were when he wrote it. jsonb rather than columns because the shape will
  -- change between campaigns and a migration per metric is worse than a documented blob — but
  -- it is *written by the database*, never by the client, so it cannot be flattered.
  snapshot jsonb not null,

  created_at timestamptz not null default now(),

  constraint weekly_reviews_week_start_is_monday
    check (extract(isodow from week_start) = 1),
  constraint weekly_reviews_one_per_week
    unique (profile_id, week_start)
);

comment on table public.weekly_reviews is
  'One review per member per week, carrying a snapshot of the numbers as they were. Immutable '
  'once written: a review that can be revised after the fact is a memoir.';

create index if not exists weekly_reviews_by_member
  on public.weekly_reviews (profile_id, week_start desc);

-- Immutable, for the same reason a commitment is. A review rewritten in the light of what
-- happened next is not a record of what he thought at the time, which is the only thing it is
-- for.
create or replace function app.refuse_weekly_review_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'weekly_review_immutable'
    using errcode = 'P0001',
          hint = 'A weekly review records what you thought at the time. It is not editable.';
end
$$;

drop trigger if exists weekly_reviews_immutable on public.weekly_reviews;
create trigger weekly_reviews_immutable
  before update on public.weekly_reviews
  for each row execute function app.refuse_weekly_review_edit();

alter table public.weekly_reviews enable row level security;
alter table public.weekly_reviews force row level security;

-- Circle-readable. The disclosure says peers see whether he filed, his commitments and whether
-- he hit them; a weekly review is the same class of fact — effort and intent, not protocol
-- detail and not amounts. The snapshot it carries is deliberately built from what a peer may
-- already see (see public.file_weekly_review below).
drop policy if exists weekly_reviews_select_own_circle on public.weekly_reviews;
create policy weekly_reviews_select_own_circle on public.weekly_reviews
  for select to authenticated using (app.shares_my_circle(weekly_reviews.profile_id));

-- No INSERT policy and no direct grant: the only way in is the RPC below, which is what makes
-- "the database computes the snapshot" true rather than a convention.
grant select on public.weekly_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- public.file_weekly_review — the snapshot is computed here, not sent
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, and this one genuinely needs to be. It has to INSERT into a table with no
-- insert policy, precisely so that the numbers cannot come from the client. Every SECURITY
-- DEFINER function in this schema is a hole if it trusts its arguments, so this one takes no
-- profile argument at all — it reads auth.uid() and can only ever write the caller's own row.
--
-- DOCTRINE §8: "A weekly review cannot be submitted with commitments still unresolved." Enforced
-- here, because it is a rule about a set of other rows and there is nowhere else it can live.
create or replace function public.file_weekly_review(
  p_week_start date,
  p_what_worked text,
  p_what_did_not text,
  p_next_week text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := auth.uid();
  v_today date;
  v_pending int;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_profile is null then
    raise exception 'review_no_session' using errcode = '42501';
  end if;

  -- Mirror note: the body of app.week_start_for(), inlined for the reason given in 0008 —
  -- though this function is DEFINER and could call it, inlining keeps the two RPCs identical
  -- in shape so neither becomes the odd one out.
  select (now() at time zone p.timezone)::date into v_today
    from public.profiles p where p.id = v_profile;
  if v_today is null then
    raise exception 'profile_missing' using errcode = '23503';
  end if;

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'review_week_not_monday' using errcode = 'P0001';
  end if;

  -- A review is written about a week that is over. Sunday is week_start + 6.
  if v_today < p_week_start + 6 then
    raise exception 'review_too_early'
      using errcode = 'P0001',
            hint = 'The week is not over yet.';
  end if;

  select count(*) into v_pending
    from public.commitments c
   where c.profile_id = v_profile
     and c.week_start = p_week_start
     and c.outcome = 'pending';

  if v_pending > 0 then
    raise exception 'review_commitments_unresolved'
      using errcode = 'P0001',
            hint = 'Answer every commitment first. A review over an unanswered week is fiction.';
  end if;

  -- The snapshot. Computed from the tables as they are *now*, and then frozen — which is the
  -- entire point of storing it rather than deriving it on read.
  select jsonb_build_object(
    'week_start',       p_week_start,
    'days_reported',    count(*),
    'days_held',        count(*) filter (where md.final_status = 'complete'),
    'days_repeated',    count(*) filter (where md.final_status = 'repeat'),
    'days_reset',       count(*) filter (where md.final_status = 'reset'),
    'deep_work_blocks', coalesce(sum(md.deep_work_blocks), 0),
    'business_actions', coalesce(sum(md.business_actions), 0),
    'revenue_minor',    coalesce(sum(md.revenue_minor), 0),
    'currencies',       coalesce(
                          (select jsonb_agg(distinct md2.currency)
                             from public.member_days md2
                            where md2.profile_id = v_profile
                              and md2.local_date >= p_week_start
                              and md2.local_date < p_week_start + 7
                              and md2.currency is not null),
                          '[]'::jsonb),
    'commitments_hit',    (select count(*) from public.commitments c
                            where c.profile_id = v_profile and c.week_start = p_week_start
                              and c.outcome = 'hit'),
    'commitments_missed', (select count(*) from public.commitments c
                            where c.profile_id = v_profile and c.week_start = p_week_start
                              and c.outcome = 'missed'),
    'doctrine_version', (select am.doctrine_version from public.app_meta am limit 1),
    'taken_at',         now()
  )
  into v_snapshot
  from public.member_days md
  where md.profile_id = v_profile
    and md.local_date >= p_week_start
    and md.local_date < p_week_start + 7;

  insert into public.weekly_reviews
    (profile_id, week_start, what_worked, what_did_not, next_week, snapshot)
  values (
    v_profile,
    p_week_start,
    nullif(btrim(p_what_worked), '')::public.capped_text_140,
    nullif(btrim(p_what_did_not), '')::public.capped_text_140,
    nullif(btrim(p_next_week), '')::public.capped_text_140,
    v_snapshot
  )
  -- Idempotent for the outbox, and the snapshot does not move on a retry: a review already
  -- filed is the one that stands. ADR-012.
  on conflict (profile_id, week_start) do nothing
  returning id into v_id;

  if v_id is null then
    select wr.id into v_id from public.weekly_reviews wr
     where wr.profile_id = v_profile and wr.week_start = p_week_start;
    return jsonb_build_object('review_id', v_id, 'created', false);
  end if;

  return jsonb_build_object('review_id', v_id, 'created', true);
end
$$;

revoke all on function public.file_weekly_review(date, text, text, text) from public, anon;
grant execute on function public.file_weekly_review(date, text, text, text) to authenticated;

comment on function public.file_weekly_review(date, text, text, text) is
  'File the week''s review. The numbers are computed here, never sent, so a snapshot cannot be '
  'flattered. Refuses while any commitment is still pending (DOCTRINE §8).';

update public.app_meta set schema_version = 9, updated_at = now() where id;
