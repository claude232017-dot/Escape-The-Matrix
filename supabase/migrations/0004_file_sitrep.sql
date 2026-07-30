-- 0004_file_sitrep.sql — Phase 2
--
-- Filing a day is one operation, so it is one statement.
--
-- Why this exists at all. A complete or repeated day is a single upsert and the client could do
-- it directly. A **reset** is not: it writes the SITREP, records a reset_event, closes the
-- enrollment and opens the next one. Four writes from a browser means four chances to lose the
-- network in the middle, and the halfway states are worse than a failure — a reset recorded with
-- no new enrollment leaves a man filing tomorrow's report against a closed campaign, and a new
-- enrollment with no reset_event loses the reason it happened.
--
-- Two properties this function has to have, both because the outbox retries (§3.10):
--
--   1. **Idempotent.** A retry after an ambiguous failure must converge on the same state, never
--      double-apply. Every write here is an upsert, a guarded insert, or a delete-then-insert.
--   2. **Atomic.** A function body is one transaction, so a failure anywhere leaves nothing
--      behind. That is the entire reason the reset path is not four client round trips.
--
-- SECURITY INVOKER, deliberately. This runs as `authenticated`, so every RLS policy in
-- 0003_forge.sql still applies to every statement inside it. A SECURITY DEFINER version would be
-- a hole in the exact shape of this function's arguments: pass someone else's enrollment id and
-- the policies would no longer be there to say no.

-- ---------------------------------------------------------------------------
-- The uniqueness the idempotency rests on
-- ---------------------------------------------------------------------------

-- One reset per enrollment per day. Also what makes the `on conflict do nothing` below a
-- convergent retry rather than a duplicate event.
create unique index if not exists reset_events_one_per_day
  on public.reset_events (enrollment_id, occurred_on);

-- An enrollment chain cannot fork. Without this, a retry that raced could give one enrollment
-- two successors, and "which day am I on" would have two answers.
create unique index if not exists enrollments_one_successor
  on public.enrollments (previous_enrollment_id)
  where previous_enrollment_id is not null;

-- ---------------------------------------------------------------------------
-- public.file_sitrep
-- ---------------------------------------------------------------------------
-- p_results is a JSON array of {protocol_id, status, med_option_id}. JSON rather than a table
-- type because PostgREST calls this over HTTP and an array of composites is not something a
-- browser client can send cleanly.
--
-- Mirror note: the client-side counterpart is toPayload() in
-- src/features/forge/sitrep-draft.ts, which derives final_status from evaluateDay(). The
-- statuses it sends are checked against the doctrine there; what is checked *here* is the part a
-- client cannot be trusted with — whose enrollment it is, which day it may file against, and
-- that a reset is never quietly undone.
create or replace function public.file_sitrep(
  p_enrollment_id uuid,
  p_local_date date,
  p_final_status public.sitrep_status,
  p_results jsonb,
  p_reset_kind public.reset_kind default null,
  p_protocols_failed text[] default '{}'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enrollment public.enrollments;
  v_sitrep_id uuid;
  v_existing_status public.sitrep_status;
  v_next_enrollment_id uuid;
  v_later_date date;
begin
  -- The ownership check is duplicated: the RLS policies on sitreps and protocol_results would
  -- reject someone else's enrollment anyway. It is here so that the failure says what happened
  -- rather than "new row violates row-level security policy for table sitreps", which tells a
  -- man nothing and tells whoever is debugging it almost nothing.
  select * into v_enrollment
    from public.enrollments
   where id = p_enrollment_id and profile_id = auth.uid();

  if v_enrollment.id is null then
    raise exception 'sitrep_enrollment_not_yours'
      using errcode = '42501',
            hint = 'You can only file against your own enrollment.';
  end if;

  select final_status into v_existing_status
    from public.sitreps
   where enrollment_id = p_enrollment_id and local_date = p_local_date;

  -- A reset cannot be taken back. It has already opened the next enrollment, and days may
  -- already have been filed against it; rewriting this one would orphan them.
  --
  -- Checked *before* the closed-enrollment rule below, because a reset closes the enrollment and
  -- so both conditions hold at once. The generic "that enrollment has ended" would be true and
  -- useless — it invites him to look for a current enrollment, when what actually happened is
  -- that the day he is trying to amend is the one that ended it.
  if v_existing_status = 'reset' and p_final_status <> 'reset' then
    raise exception 'sitrep_reset_is_final'
      using errcode = '23514',
            hint = 'A reset has already been recorded for that day and the campaign has moved on.';
  end if;

  -- A closed enrollment accepts exactly one thing: another go at the reset that closed it.
  --
  -- That exception is not a courtesy, it is what makes the function safe to retry. Filing a
  -- reset sets this enrollment to 'reset'; if the response were then lost, the outbox would send
  -- the identical call again and a bare status check would reject it for ever. The entry would
  -- sit in the queue being refused by the very state it created. Found by the idempotency test in
  -- tests/db/file-sitrep.test.ts, which is the only place it could have been found.
  if v_enrollment.status <> 'active'
     and not (v_existing_status = 'reset' and p_final_status = 'reset') then
    raise exception 'sitrep_enrollment_closed'
      using errcode = '23514',
            hint = 'That enrollment has ended. Its history is intact; file against the current one.';
  end if;

  -- A reset may only be filed for the last reported day of the enrollment. Amending an earlier
  -- day into a reset would start the next enrollment on a date that already has reports against
  -- this one, and every aggregate over "day 1" would then count that date twice.
  if p_final_status = 'reset' then
    select max(local_date) into v_later_date
      from public.sitreps
     where enrollment_id = p_enrollment_id and local_date > p_local_date;

    if v_later_date is not null then
      raise exception 'sitrep_reset_not_latest'
        using errcode = '23514',
              hint = 'You have already filed a later day in this enrollment.';
    end if;
  end if;

  insert into public.sitreps (enrollment_id, local_date, final_status)
  values (p_enrollment_id, p_local_date, p_final_status)
  on conflict (enrollment_id, local_date)
    do update set final_status = excluded.final_status
  returning id into v_sitrep_id;

  -- Delete-then-insert rather than upsert per row: the results are a restatement of one day, and
  -- an upsert would leave behind a result for a protocol the mentor has since removed from the
  -- catalogue, silently changing what the day evaluates to.
  delete from public.protocol_results where sitrep_id = v_sitrep_id;

  insert into public.protocol_results (sitrep_id, protocol_id, status, med_option_id)
  select v_sitrep_id,
         (result->>'protocol_id')::uuid,
         (result->>'status')::public.protocol_result_status,
         nullif(result->>'med_option_id', '')::uuid
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) as result;

  if p_final_status = 'reset' then
    -- The fact, before the consequence. Recorded with the failed slugs so the event stands alone
    -- in later analysis even after the protocol catalogue is edited.
    insert into public.reset_events (enrollment_id, occurred_on, kind, protocols_failed)
    values (p_enrollment_id, p_local_date, coalesce(p_reset_kind, 'zero_day'), coalesce(p_protocols_failed, '{}'))
    on conflict (enrollment_id, occurred_on) do nothing;

    -- Order matters: enrollments_one_active_per_campaign is a partial unique index on the
    -- active rows, so this one has to stop being active before the next one can exist.
    update public.enrollments set status = 'reset'
     where id = p_enrollment_id and status = 'active';

    select id into v_next_enrollment_id
      from public.enrollments
     where previous_enrollment_id = p_enrollment_id;

    if v_next_enrollment_id is null then
      -- The day after the breach, not the same day: the breach belongs to the enrollment it
      -- happened in. See enrollmentAfterReset() in src/features/forge/doctrine.ts.
      insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id)
      values (v_enrollment.profile_id, v_enrollment.campaign_id, p_local_date + 1, p_enrollment_id)
      returning id into v_next_enrollment_id;
    end if;
  end if;

  return jsonb_build_object(
    'sitrep_id', v_sitrep_id,
    'final_status', p_final_status,
    'next_enrollment_id', v_next_enrollment_id
  );
end
$$;

comment on function public.file_sitrep(uuid, date, public.sitrep_status, jsonb, public.reset_kind, text[]) is
  'Files one day: the SITREP, its protocol results, and — for a reset — the reset event, the '
  'closing of this enrollment and the opening of the next. Idempotent, so the outbox may retry '
  'it. SECURITY INVOKER, so every RLS policy still applies.';

-- Functions are executable by PUBLIC by default, and `authenticated` inherits that. The default
-- privileges revoked in 0001 do not touch the PUBLIC grant, so it is revoked explicitly: an RPC
-- reachable with the anon key is an RPC reachable by anyone with the bundle.
revoke all on function public.file_sitrep(uuid, date, public.sitrep_status, jsonb, public.reset_kind, text[]) from public;
revoke all on function public.file_sitrep(uuid, date, public.sitrep_status, jsonb, public.reset_kind, text[]) from anon;
grant execute on function public.file_sitrep(uuid, date, public.sitrep_status, jsonb, public.reset_kind, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- public.start_campaign_enrollment
-- ---------------------------------------------------------------------------
-- Joining the campaign. One statement for the same reason: the enrollment is created only if the
-- man does not already have an active one, and "check then insert" from a browser is a race that
-- resolves into a unique-violation the client then has to interpret.
create or replace function public.start_campaign_enrollment(p_campaign_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enrollment_id uuid;
  v_starts_on date;
  v_today date;
begin
  select id into v_enrollment_id
    from public.enrollments
   where profile_id = auth.uid() and campaign_id = p_campaign_id and status = 'active';

  if v_enrollment_id is not null then
    return v_enrollment_id;
  end if;

  select starts_on into v_starts_on from public.campaigns where id = p_campaign_id;
  if v_starts_on is null then
    raise exception 'campaign_not_found' using errcode = '23503';
  end if;

  -- Today, resolved from his own timezone — not from anything the client said. A man joining on
  -- day 9 of a campaign starts on day 1 of his own thirty days; back-dating to the campaign's
  -- start would credit him with eight days he did not run, and the enrollment trigger permits
  -- that date, so this is the only place the rule can live.
  --
  -- Mirror note: this expression is the body of app.today_for() in 0003_forge.sql, and of
  -- getLocalDateString() in src/lib/date.ts. It is inlined rather than called because this
  -- function is SECURITY INVOKER: it runs as `authenticated`, which has no USAGE on the app
  -- schema and therefore cannot look a function up in it. See ADR-011.
  select (now() at time zone p.timezone)::date into v_today
    from public.profiles p where p.id = auth.uid();

  if v_today is null then
    raise exception 'profile_missing' using errcode = '23503';
  end if;

  -- A campaign that has not started cannot be joined: the enrollment trigger caps started_on at
  -- the member's own tomorrow, so this would otherwise surface as a date error about a rule the
  -- man never broke.
  if v_starts_on > v_today + 1 then
    raise exception 'campaign_not_started'
      using errcode = '23514',
            hint = 'That campaign has not begun yet.';
  end if;

  insert into public.enrollments (profile_id, campaign_id, started_on)
  values (auth.uid(), p_campaign_id, greatest(v_starts_on, v_today))
  returning id into v_enrollment_id;

  return v_enrollment_id;
end
$$;

comment on function public.start_campaign_enrollment(uuid) is
  'Returns the caller''s active enrollment in a campaign, creating it if absent. Start date is '
  'the later of the campaign start and the member''s own today: joining late does not backdate.';

revoke all on function public.start_campaign_enrollment(uuid) from public;
revoke all on function public.start_campaign_enrollment(uuid) from anon;
grant execute on function public.start_campaign_enrollment(uuid) to authenticated;

update public.app_meta set schema_version = 4, updated_at = now() where id;
