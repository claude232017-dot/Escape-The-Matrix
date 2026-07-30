-- NOT A MIGRATION. Run once, by hand, after 01_first_mentor.sql and after the mentor has joined.
--
-- Creates the circle's first campaign and seeds the protocol catalogue into it. Until this runs,
-- the SITREP screen has nothing to offer and says so ("not enrolled yet") rather than showing an
-- empty form — but the reason is that no campaign exists, which is not something the screen can
-- explain to a man who does not know it is missing.
--
-- Why this is a bootstrap script rather than a migration: a campaign belongs to a *circle*, and
-- migrations run before any circle exists. Why it is not in the UI: creating a campaign is a
-- once-a-month decision made by one person, and a screen for it would be a screen nobody opens —
-- "if a feature only makes sense at 10,000 users, it does not belong here" applies just as well
-- to a feature that makes sense twelve times a year.
--
-- Safe to re-run at any stage. It reuses an existing campaign with the same name, re-seeds
-- idempotently, and enrolls nobody — men enroll themselves from the screen, because Day 1 should
-- be a decision a man makes rather than a row that appeared while he was asleep.
--
-- Change the two marked lines before running.

do $$
declare
  v_circle_id uuid;
  v_campaign_id uuid;
  v_seeded integer;
  v_protocols integer;
  v_options integer;

  -- CHANGE THIS if you want a different name. It is shown on the enrollment panel.
  v_name text := 'Campaign One';

  -- Leave NULL for "the mentor's today", or set a date to open the campaign later.
  --
  -- NULL rather than current_date on purpose. `current_date` is the *server's* date, which
  -- Supabase runs in UTC — so a mentor in New York running this at 8pm gets a campaign starting
  -- tomorrow, and nobody west of UTC can file until it arrives. It resolves in his own timezone
  -- instead, which is what he means by "today". Same rule as everywhere else in this codebase:
  -- a date is resolved in a person's zone, never in the server's. See src/lib/date.ts.
  --
  -- A man who joins after this date starts on his own Day 1, not on the campaign's day count —
  -- public.start_campaign_enrollment takes the LATER of the campaign start and his own today, so
  -- a late joiner is never credited with days he did not run. A future date is a legitimate way
  -- to make everyone start together.
  --
  -- The consequence, stated: if the mentor is a day ahead of a member (a mentor in Auckland, a
  -- member in New York), that member's Day 1 is his tomorrow and he cannot file today. That is
  -- the right direction to err — the alternative, starting from the earliest member's date, puts
  -- somebody's Day 1 in the past and hands him a day he did not run. If it matters, set an
  -- explicit date a day earlier.
  v_starts_on date := null;
  v_mentor_id uuid;

  -- 30 days, per the doctrine. Stored per campaign so a later one can differ without rewriting
  -- the history of this one.
  v_length_days integer := 30;
begin
  select id into v_circle_id from public.circles order by created_at limit 1;
  if v_circle_id is null then
    raise exception 'No circle exists. Run 01_first_mentor.sql first.';
  end if;

  if v_starts_on is null then
    select id into v_mentor_id
      from public.profiles
     where circle_id = v_circle_id and role = 'mentor'
     order by created_at
     limit 1;

    if v_mentor_id is null then
      raise exception
        'No mentor has joined this circle yet, so there is no timezone to resolve "today" in. '
        'Create the mentor account first, or set v_starts_on to an explicit date.';
    end if;

    v_starts_on := app.today_for(v_mentor_id);
    raise notice 'starting on the mentor''s today (%), server date is %', v_starts_on, current_date;
  end if;

  select id into v_campaign_id
    from public.campaigns
   where circle_id = v_circle_id and name = v_name;

  if v_campaign_id is null then
    insert into public.campaigns (circle_id, name, starts_on, length_days)
    values (v_circle_id, v_name, v_starts_on, v_length_days)
    returning id into v_campaign_id;
    raise notice 'created campaign "%" (%) starting %', v_name, v_campaign_id, v_starts_on;
  else
    raise notice 'reusing existing campaign "%" (%)', v_name, v_campaign_id;
  end if;

  -- Idempotent: every insert inside is ON CONFLICT DO NOTHING, so this re-seeds protocols the
  -- mentor has deleted and leaves alone the ones he has edited.
  select app.seed_protocols_for_campaign(v_campaign_id) into v_seeded;

  select count(*) into v_protocols from public.protocols where campaign_id = v_campaign_id;
  select count(*) into v_options
    from public.protocol_med_options o
    join public.protocols p on p.id = o.protocol_id
   where p.campaign_id = v_campaign_id;

  raise notice '% protocols, % MED options', v_protocols, v_options;
  raise notice 'Done. Each man now enrols himself from the SITREP screen.';
end
$$;

-- ---------------------------------------------------------------------------
-- What you should see
-- ---------------------------------------------------------------------------
-- Eleven protocols across five activation waves (DOCTRINE §2.0), and five MED options. If the
-- counts differ, app.seed_protocols_for_campaign has been edited and docs/DOCTRINE.md is now
-- wrong about what a man is judged against on a given day.
select
  p.activates_on_day as day,
  p.slug,
  p.kind,
  p.visibility,
  p.is_treason_trigger as treason,
  count(o.id) as med_options
from public.protocols p
left join public.protocol_med_options o on o.protocol_id = p.id
join public.campaigns c on c.id = p.campaign_id
where c.name = 'Campaign One'   -- keep in step with v_name above
group by p.id, p.activates_on_day, p.slug, p.kind, p.visibility, p.is_treason_trigger
order by p.activates_on_day, p.sort_order;
