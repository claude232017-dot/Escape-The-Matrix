-- 0005_debrief.sql — Phase 3
--
-- The debrief: what a man learned from the day, in a shape that can be queried.
--
-- The circle's current debrief is two prose paragraphs. Thirty days times twelve men is roughly
-- seven hundred reports that nobody can aggregate, and the intelligence in them never
-- materialises. This keeps the thinking and drops the blank page (ADR-001).
--
-- ---------------------------------------------------------------------------
-- Why this is two tables and not one
-- ---------------------------------------------------------------------------
-- The two halves of a debrief have genuinely different audiences, and putting them in one table
-- would mean the difference lived in a policy someone could loosen without noticing.
--
--   * The **Top G Insight** is a system that worked. Sharing it is the entire point of a circle,
--     and Phase 7's playbooks are built out of these. Circle-readable.
--
--   * The **Bottom G Tactic** is a record of when a specific man is psychologically weakest, what
--     reliably beats him, and the exact lie he tells himself. That is §3.5 data about an
--     identified individual. Self and mentor only (ADR-009).
--
-- DOCTRINE §7 draws the line precisely: what a member sees of another is his report status, his
-- commitments, and **whether he was hit** — not the itemised tactic. So `attacked` and `outcome`
-- live in the peer-readable table and everything about *how* lives in the private one. A peer's
-- query for insights cannot return failure detail, because the columns are not in the table he is
-- allowed to read. Structural, not a policy.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  -- The named triggers from DOCTRINE §6.2. An enum rather than free text because this is the
  -- column the whole feature aggregates on: "low energy is his most successful weapon against
  -- you" is a GROUP BY, and a GROUP BY over prose is a list of seven hundred distinct strings.
  if not exists (select 1 from pg_type where typname = 'bottom_g_trigger' and typnamespace = 'public'::regnamespace) then
    create type public.bottom_g_trigger as enum (
      'low_energy', 'stress', 'boredom', 'loneliness', 'fatigue',
      'celebration', 'social_pressure', 'frustration', 'other'
    );
  end if;

  -- Not a pass/fail. A man who was ambushed and held is not in the same position as one who was
  -- not ambushed at all, and neither is the same as one who lost — "you hold against stress 8
  -- times in 10" needs all three states to be a sentence anyone can act on.
  if not exists (select 1 from pg_type where typname = 'attack_outcome' and typnamespace = 'public'::regnamespace) then
    create type public.attack_outcome as enum ('resisted', 'partial', 'lost');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- debriefs — the Top G Insight, and whether he was hit
-- ---------------------------------------------------------------------------
create table if not exists public.debriefs (
  id uuid primary key default extensions.gen_random_uuid(),
  -- One per SITREP. A day has one debrief; the unique constraint is also the upsert target that
  -- makes public.file_debrief idempotent for the outbox.
  sitrep_id uuid not null unique references public.sitreps (id) on delete cascade,

  -- The Top G Insight. Both capped: the instruction is to name a replicable cause, and a field
  -- that accepts a paragraph invites the prose this table exists to replace.
  system_used app.capped_text_140,
  victory app.capped_text_140,
  insight_protocol_id uuid references public.protocols (id) on delete set null,

  -- Whether the Bottom G attacked at all.
  --
  -- NOT NULL and always answered, because absence is otherwise ambiguous: a day with no tactic
  -- row could mean nothing happened or could mean he did not fill it in, and those two must never
  -- be the same value. Same principle as an unreported protocol not being a pass.
  attacked boolean not null,
  outcome public.attack_outcome,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A system with no victory, or a victory with no system, is half a thought. The point of the
  -- pair is the causal link between them.
  constraint debriefs_insight_paired check ((system_used is null) = (victory is null)),
  constraint debriefs_insight_protocol_needs_insight
    check (insight_protocol_id is null or victory is not null),
  -- An attack always has an outcome; no attack never has one.
  constraint debriefs_outcome_iff_attacked
    check ((outcome is not null) = attacked)
);

alter table public.debriefs enable row level security;
alter table public.debriefs force row level security;
create index if not exists debriefs_sitrep_idx on public.debriefs (sitrep_id);

drop trigger if exists debriefs_touch_updated_at on public.debriefs;
create trigger debriefs_touch_updated_at
  before update on public.debriefs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- bottom_g_tactics — when, by what, and the lie
-- ---------------------------------------------------------------------------
-- Separate table, separate policy, separate audience. See the header.
create table if not exists public.bottom_g_tactics (
  id uuid primary key default extensions.gen_random_uuid(),
  sitrep_id uuid not null unique references public.sitreps (id) on delete cascade,

  -- "The single most valuable column in the schema" — DOCTRINE §6.2.
  --
  -- The hour in the **member's own timezone**, resolved on the client before it arrives, exactly
  -- like sitreps.local_date. Storing an instant and extracting the hour here would report a New
  -- York member's 15:00 ambush as 20:00, and "your enemy attacks between 14:00 and 16:00" would
  -- be a sentence about the server.
  --
  -- Mirror note: resolved by localHour() in src/features/forge/debrief-draft.ts.
  occurred_at_hour smallint not null
    constraint bottom_g_tactics_hour_range check (occurred_at_hour between 0 and 23),
  trigger_kind public.bottom_g_trigger not null,
  -- The exact lie, in his own words. The one free-text field in the feature, and capped: it is
  -- meant to be the sentence the enemy used, not an account of the day.
  propaganda app.capped_text_140,
  protocol_id uuid references public.protocols (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bottom_g_tactics enable row level security;
alter table public.bottom_g_tactics force row level security;
create index if not exists bottom_g_tactics_trigger_idx on public.bottom_g_tactics (trigger_kind);
create index if not exists bottom_g_tactics_hour_idx on public.bottom_g_tactics (occurred_at_hour);

drop trigger if exists bottom_g_tactics_touch_updated_at on public.bottom_g_tactics;
create trigger bottom_g_tactics_touch_updated_at
  before update on public.bottom_g_tactics
  for each row execute function app.touch_updated_at();

-- A tactic row may only exist for a day he said he was attacked. Spans two tables, so it is a
-- trigger rather than a CHECK. Without it the two halves can disagree, and a peer reading
-- `attacked = false` while the mentor reads a 15:00 ambush is the worst kind of inconsistency:
-- both parties believe they are looking at the same day.
create or replace function app.validate_bottom_g_tactic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.debriefs d where d.sitrep_id = new.sitrep_id and d.attacked
  ) then
    raise exception 'tactic_without_attack'
      using errcode = '23514',
            hint = 'Record the attack on the debrief before describing the tactic.';
  end if;
  return new;
end
$$;

drop trigger if exists bottom_g_tactics_validate on public.bottom_g_tactics;
create trigger bottom_g_tactics_validate
  before insert or update of sitrep_id on public.bottom_g_tactics
  for each row execute function app.validate_bottom_g_tactic();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- The insight is the circle's to read. That is what makes a circle worth being in, and it is
-- where Phase 7's playbooks come from.
drop policy if exists debriefs_select_own_circle on public.debriefs;
create policy debriefs_select_own_circle on public.debriefs
  for select to authenticated
  using (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = debriefs.sitrep_id and app.shares_my_circle(e.profile_id)
  ));

drop policy if exists debriefs_write_self on public.debriefs;
create policy debriefs_write_self on public.debriefs
  for all to authenticated
  using (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = debriefs.sitrep_id and e.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = debriefs.sitrep_id and e.profile_id = auth.uid()
  ));

-- The tactic is his and the mentor's. Not the circle's — when a man is weakest and what
-- reliably beats him is not a fact about his day, it is a map of how to break him.
drop policy if exists bottom_g_tactics_select_scoped on public.bottom_g_tactics;
create policy bottom_g_tactics_select_scoped on public.bottom_g_tactics
  for select to authenticated
  using (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = bottom_g_tactics.sitrep_id
       and (
         e.profile_id = auth.uid()
         or (app.is_mentor() and app.shares_my_circle(e.profile_id))
       )
  ));

drop policy if exists bottom_g_tactics_write_self on public.bottom_g_tactics;
create policy bottom_g_tactics_write_self on public.bottom_g_tactics
  for all to authenticated
  using (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = bottom_g_tactics.sitrep_id and e.profile_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = bottom_g_tactics.sitrep_id and e.profile_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- DELETE on both, unlike sitreps and enrollments: a debrief is a man's own reflection rather
-- than a record of what he did, and "I was not attacked after all" has to be expressible. The
-- day itself — which is the history ADR-002 protects — is untouched by either.
grant select, insert, update, delete on public.debriefs to authenticated;
grant select, insert, update, delete on public.bottom_g_tactics to authenticated;

-- ---------------------------------------------------------------------------
-- public.file_debrief
-- ---------------------------------------------------------------------------
-- One call, for the same reasons as public.file_sitrep (ADR-012): the two halves must not
-- half-apply, and the outbox retries. SECURITY INVOKER, so every policy above still applies.
create or replace function public.file_debrief(
  p_sitrep_id uuid,
  p_attacked boolean,
  p_system_used text default null,
  p_victory text default null,
  p_insight_protocol_id uuid default null,
  p_outcome public.attack_outcome default null,
  p_occurred_at_hour smallint default null,
  p_trigger_kind public.bottom_g_trigger default null,
  p_propaganda text default null,
  p_attacked_protocol_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_debrief_id uuid;
  v_owned boolean;
begin
  -- Named explicitly so the failure says what happened, rather than surfacing as a policy
  -- violation on a table the caller never mentioned.
  select exists (
    select 1 from public.sitreps s
      join public.enrollments e on e.id = s.enrollment_id
     where s.id = p_sitrep_id and e.profile_id = auth.uid()
  ) into v_owned;

  if not v_owned then
    raise exception 'debrief_sitrep_not_yours'
      using errcode = '42501',
            hint = 'You can only debrief your own day.';
  end if;

  insert into public.debriefs (sitrep_id, system_used, victory, insight_protocol_id, attacked, outcome)
  values (p_sitrep_id, p_system_used, p_victory, p_insight_protocol_id, p_attacked, p_outcome)
  on conflict (sitrep_id) do update
    set system_used = excluded.system_used,
        victory = excluded.victory,
        insight_protocol_id = excluded.insight_protocol_id,
        attacked = excluded.attacked,
        outcome = excluded.outcome
  returning id into v_debrief_id;

  if p_attacked then
    insert into public.bottom_g_tactics
      (sitrep_id, occurred_at_hour, trigger_kind, propaganda, protocol_id)
    values (p_sitrep_id, p_occurred_at_hour, p_trigger_kind, p_propaganda, p_attacked_protocol_id)
    on conflict (sitrep_id) do update
      set occurred_at_hour = excluded.occurred_at_hour,
          trigger_kind = excluded.trigger_kind,
          propaganda = excluded.propaganda,
          protocol_id = excluded.protocol_id;
  else
    -- Amending "I was attacked" down to "I was not" has to remove the tactic, or the two halves
    -- disagree and the cross-table trigger would reject the next write to it.
    delete from public.bottom_g_tactics where sitrep_id = p_sitrep_id;
  end if;

  return jsonb_build_object('debrief_id', v_debrief_id, 'attacked', p_attacked);
end
$$;

comment on function public.file_debrief(uuid, boolean, text, text, uuid, public.attack_outcome, smallint, public.bottom_g_trigger, text, uuid) is
  'Writes both halves of a debrief in one transaction. Idempotent, so the outbox may retry it. '
  'SECURITY INVOKER, so every RLS policy still applies.';

-- Functions are EXECUTE-to-PUBLIC by default and the default privileges revoked in 0001 do not
-- remove that grant. An RPC reachable with the anon key is an RPC reachable by anyone with the
-- bundle. Asserted by the allowlist in tests/db/rls-posture.test.ts.
revoke all on function public.file_debrief(uuid, boolean, text, text, uuid, public.attack_outcome, smallint, public.bottom_g_trigger, text, uuid) from public;
revoke all on function public.file_debrief(uuid, boolean, text, text, uuid, public.attack_outcome, smallint, public.bottom_g_trigger, text, uuid) from anon;
grant execute on function public.file_debrief(uuid, boolean, text, text, uuid, public.attack_outcome, smallint, public.bottom_g_trigger, text, uuid) to authenticated;

update public.app_meta set schema_version = 5, updated_at = now() where id;
