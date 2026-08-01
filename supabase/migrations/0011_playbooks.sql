-- 0011_playbooks.sql — Phase 7
--
-- A system that worked for one man, offered to the rest.
--
-- ---------------------------------------------------------------------------
-- What a playbook is for
-- ---------------------------------------------------------------------------
-- ADR-013: "Sharing that is the entire reason a circle exists, and Phase 7's playbooks are
-- built by aggregating them." The raw material is the Top G Insight — `debriefs.system_used`
-- plus the victory it won, already circle-readable.
--
-- The question a circle can answer that a man alone cannot is **does it transfer**. One man
-- laying his gym clothes out the night before is an anecdote. Five men trying it and four of
-- them holding is a finding. Five men trying it and four of them failing is *also* a finding,
-- and the more useful one: it says the system is personal rather than general, which is exactly
-- what a man needs to know before he blames himself for it not working.
--
-- So this schema is built to be able to say the disappointing thing. There is no upvote, no
-- adoption count on the catalogue, and nothing that makes a playbook look better for being
-- popular.
--
-- ---------------------------------------------------------------------------
-- Everything §1 rules out, refused structurally
-- ---------------------------------------------------------------------------
-- This is the most social-feed-shaped feature in the product, so restraint is not enough — the
-- shape has to make the alternatives unavailable:
--
--   * **No likes, votes or reactions.** There is no column for one. A count of approval is a
--     popularity contest, and a popularity contest ranks men by how well their ideas sell.
--   * **No comments.** Same reason directives have no reply column (0010).
--   * **No author reputation.** `promoted_from` records which debrief a playbook came from so
--     the source is attributable, but nothing aggregates playbooks *by author*, and no query in
--     this codebase counts a man's contributions.
--   * **The mentor promotes, not the author.** Twelve men over thirty days produce hundreds of
--     insights; self-promotion would turn the catalogue into a feed and the act of promoting
--     into a status move. It is curation, the same way the campaign and the business actions
--     are curated.
--
-- ---------------------------------------------------------------------------
-- Who can see an application, and why it is not the circle
-- ---------------------------------------------------------------------------
-- `playbook_applications` is **self and mentor only**, like money and unlike commitments.
--
-- The reason is the enrollment disclosure. It tells a member exactly what his peers see: whether
-- he filed, whether his day held, his weekly commitments and whether he hit them. "Marcus tried
-- this system and it did not work for him" is not on that list. It is mild, and it is still a
-- new fact about a named man that he was not told would be shared — and the fix for that is a
-- new disclosure version and re-consent from everyone, not a quiet widening.
--
-- The transfer counts are what the circle actually needs, and those carry no names. They come
-- from `public.playbook_transfer()` below, which is SECURITY DEFINER precisely so it can count
-- rows the caller may not read, and returns nothing but numbers.

-- ---------------------------------------------------------------------------
-- playbooks
-- ---------------------------------------------------------------------------
create table if not exists public.playbooks (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  -- The debrief this was promoted from. Nullable because the mentor may write one from
  -- somewhere other than a filed insight — a conversation, his own experience — and forcing a
  -- fake source row would be worse than admitting there is none.
  promoted_from uuid references public.debriefs (id) on delete set null,
  promoted_by uuid not null references public.profiles (id) on delete restrict,
  -- The name a man will recognise it by. Short on purpose: a playbook that needs a paragraph to
  -- name has not been understood yet.
  title public.capped_text_140 not null,
  -- The system itself, in the words of the man it worked for.
  body public.capped_text_140 not null,
  -- Which protocol it defends, when it defends one.
  protocol_id uuid references public.protocols (id) on delete set null,
  -- Retired rather than deleted: a playbook somebody adopted is part of his record, and
  -- deleting it would take his application with it.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),

  constraint playbooks_title_not_blank check (btrim(title) <> ''),
  constraint playbooks_body_not_blank check (btrim(body) <> ''),
  -- One playbook per source. Promoting the same insight twice is how a catalogue grows
  -- duplicates that then split their own transfer evidence between them.
  constraint playbooks_one_per_source unique (promoted_from)
);

comment on table public.playbooks is
  'A system promoted from a Top G Insight for the circle to try. Mentor-curated. No votes, no '
  'comments, no author ranking — see the header of 0011 for why each absence is deliberate.';

create index if not exists playbooks_by_circle on public.playbooks (circle_id, created_at desc);

alter table public.playbooks enable row level security;
alter table public.playbooks force row level security;

drop policy if exists playbooks_select_own_circle on public.playbooks;
create policy playbooks_select_own_circle on public.playbooks
  for select to authenticated using (circle_id = app.current_circle_id());

-- Mentor only, and only into his own circle. `app.is_mentor()` alone would let him promote into
-- somebody else's — the same gap 0010's directives had to close.
drop policy if exists playbooks_write_mentor on public.playbooks;
create policy playbooks_write_mentor on public.playbooks
  for insert to authenticated
  with check (
    app.is_mentor()
    and circle_id = app.current_circle_id()
    and promoted_by = auth.uid()
  );

-- Retiring one is an update of `is_active` only; the text is immutable for the same reason a
-- commitment's is. Men have adopted this and are working from the words as written.
drop policy if exists playbooks_retire_mentor on public.playbooks;
create policy playbooks_retire_mentor on public.playbooks
  for update to authenticated
  using (app.is_mentor() and circle_id = app.current_circle_id())
  with check (app.is_mentor() and circle_id = app.current_circle_id());

grant select, insert on public.playbooks to authenticated;
-- Column-level, so "retire" is the only update possible. A WITH CHECK cannot see OLD, so a
-- policy could not express this — the grant can. Same mechanism as profiles in 0002.
grant update (is_active) on public.playbooks to authenticated;

-- ---------------------------------------------------------------------------
-- playbook_applications
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_outcome') then
    create type public.application_outcome as enum ('pending', 'held', 'did_not');
  end if;
end
$$;

comment on type public.application_outcome is
  'Two answers and a waiting state. `did_not` rather than `failed`: the system did not transfer, '
  'which is a fact about the system as much as about the man. There is no "partly" — a third '
  'answer would make the whole thing negotiable, exactly as it would for a commitment.';

create table if not exists public.playbook_applications (
  id uuid primary key default extensions.gen_random_uuid(),
  playbook_id uuid not null references public.playbooks (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  adopted_on date not null,
  outcome public.application_outcome not null default 'pending',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),

  -- One per man per playbook. Without it a man could adopt the same system five times and move
  -- its transfer rate on his own, which would make the one number this feature produces a lie.
  constraint applications_one_per_man unique (playbook_id, profile_id),
  constraint applications_resolved_together
    check ((outcome = 'pending') = (resolved_at is null))
);

comment on table public.playbook_applications is
  'One man trying one playbook. Self and mentor only — the enrollment disclosure does not tell '
  'a member his peers will see which systems failed for him. The circle sees counts, via '
  'public.playbook_transfer().';

create index if not exists applications_by_playbook
  on public.playbook_applications (playbook_id);

create or replace function app.stamp_application_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.outcome is distinct from old.outcome then
    if new.outcome = 'pending' then
      raise exception 'application_already_answered'
        using errcode = 'P0001',
              hint = 'You can correct the answer, not take it back to unanswered.';
    end if;
    new.resolved_at := now();
  end if;
  -- The playbook and the man are fixed once adopted. Re-pointing an application at a different
  -- playbook would move evidence from one system to another without a trace.
  if new.playbook_id is distinct from old.playbook_id
     or new.profile_id is distinct from old.profile_id then
    raise exception 'application_immutable' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists applications_stamp on public.playbook_applications;
create trigger applications_stamp
  before update on public.playbook_applications
  for each row execute function app.stamp_application_outcome();

alter table public.playbook_applications enable row level security;
alter table public.playbook_applications force row level security;

-- His own, plus the mentor's — exactly the money rule (ADR-009 disclosed the mentor sees all).
drop policy if exists applications_select_self_or_mentor on public.playbook_applications;
create policy applications_select_self_or_mentor on public.playbook_applications
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (app.is_mentor() and app.shares_my_circle(profile_id))
  );

drop policy if exists applications_write_self on public.playbook_applications;
create policy applications_write_self on public.playbook_applications
  for insert to authenticated
  with check (profile_id = auth.uid() and outcome = 'pending');

drop policy if exists applications_update_self on public.playbook_applications;
create policy applications_update_self on public.playbook_applications
  for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Abandoning a system he has not answered for is allowed; deleting one he answered is not,
-- because that is how a man removes the evidence that something did not work for him.
drop policy if exists applications_delete_pending on public.playbook_applications;
create policy applications_delete_pending on public.playbook_applications
  for delete to authenticated
  using (profile_id = auth.uid() and outcome = 'pending');

grant select, insert, update, delete on public.playbook_applications to authenticated;

-- ---------------------------------------------------------------------------
-- public.playbook_transfer — the counts, and no names
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, deliberately and narrowly. It exists to count rows the caller is **not**
-- allowed to read, which is the only way to show a circle whether a system travels without
-- showing it who it failed for.
--
-- Every SECURITY DEFINER function is a hole if it trusts its arguments, so this one takes none.
-- It reads `auth.uid()`, resolves his circle, and returns four numbers per playbook. There is no
-- profile_id in the result and no way to ask it about a particular man.
create or replace function public.playbook_transfer()
returns table (
  playbook_id uuid,
  adopted integer,
  held integer,
  did_not integer,
  pending integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    count(a.id)::integer,
    count(a.id) filter (where a.outcome = 'held')::integer,
    count(a.id) filter (where a.outcome = 'did_not')::integer,
    count(a.id) filter (where a.outcome = 'pending')::integer
  from public.playbooks p
  left join public.playbook_applications a on a.playbook_id = p.id
  where p.circle_id = app.current_circle_id()
  group by p.id
$$;

revoke all on function public.playbook_transfer() from public, anon;
grant execute on function public.playbook_transfer() to authenticated;

comment on function public.playbook_transfer() is
  'Adoption counts per playbook for the caller''s circle. Names nobody, takes no arguments, and '
  'is SECURITY DEFINER so it can count applications the caller may not read.';

update public.app_meta set schema_version = 11, updated_at = now() where id;
