-- NOT A MIGRATION. Run once, by hand, before anyone opens the Ledger.
--
-- Seeds ADR-003's six leading indicators into the circle. Until this runs, the Ledger shows a
-- venture with nothing to record against it — which looks like a broken screen rather than a
-- missing setup step, because there is no way for the screen to know the difference.
--
-- Why a script and not the app: the action list is the commercial doctrine. It decides what
-- twelve men optimise for over thirty days, and getting it wrong produces a month of the wrong
-- work rather than a bad dashboard. That is a decision the mentor makes once, deliberately, not
-- something a member stumbles into by tapping a button.
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING, so it restores anything deleted and
-- leaves anything edited alone.

do $$
declare
  v_circle_id uuid;
  v_count integer;
begin
  select id into v_circle_id from public.circles order by created_at limit 1;
  if v_circle_id is null then
    raise exception 'No circle exists. Run 01_first_mentor.sql first.';
  end if;

  select app.seed_business_actions_for_circle(v_circle_id) into v_count;
  raise notice 'circle % now has % business actions', v_circle_id, v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- What you should see
-- ---------------------------------------------------------------------------
-- Six actions, in the order ADR-003 lists them. The seventh slot is deliberately empty — it is
-- for one venture-specific action added once there is a week of real data to argue from. An
-- eighth is refused by app.enforce_business_action_ceiling(), because seven is the point where
-- the daily entry stops being fillable one-handed in under a minute.
select sort_order, slug, label, unit, is_active
  from public.business_actions
 where circle_id = (select id from public.circles order by created_at limit 1)
 order by sort_order;
