-- 0010_directives.sql — Phase 6/7
--
-- The mentor's instruction to one man, for one week.
--
-- ---------------------------------------------------------------------------
-- Why this is not a message
-- ---------------------------------------------------------------------------
-- §1 rules out chat. This is the feature that most resembles one, so the shape has to make the
-- difference structural rather than a matter of restraint:
--
--   * **One direction.** The subject cannot reply. There is no thread, no read receipt and no
--     second row — if he wants to answer, he answers in his weekly review or he says it to the
--     mentor's face. A reply column is the whole of a chat app; leaving it out is what keeps
--     this a directive.
--   * **One per man per week.** Not a feed. The cap is a unique constraint, so a mentor who
--     wants to say something else has to replace what he said, which is a different act from
--     adding to it.
--   * **Capped at 140 characters.** ADR-001. A directive is an instruction, and an instruction
--     that needs a paragraph is not yet an instruction.
--
-- ---------------------------------------------------------------------------
-- Who can see it
-- ---------------------------------------------------------------------------
-- **Author and subject only** — DATA-MODEL says so, and it is the one place in this schema
-- where the circle is deliberately shut out of something about a member. A directive read by
-- everyone is a public correction, and a public correction is a thing a man defends himself
-- against rather than acts on.
--
-- Note what that means for the mentor's own privilege: `app.is_mentor()` gets him the right to
-- *write* one, and buys him nothing on the read side. He sees the directives he wrote. Another
-- mentor, in a future circle with two, would not see them.

create table if not exists public.mentor_directives (
  id uuid primary key default extensions.gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  body public.capped_text_140 not null,
  created_at timestamptz not null default now(),

  constraint directives_week_start_is_monday
    check (extract(isodow from week_start) = 1),
  constraint directives_body_not_blank
    check (btrim(body) <> ''),
  -- A mentor writing himself an instruction is a note, and §9 rules out the private journal.
  constraint directives_not_self
    check (author_id <> subject_id),
  -- One per man per week, from one author. The cap that stops this becoming a feed.
  constraint directives_one_per_subject_week
    unique (author_id, subject_id, week_start)
);

comment on table public.mentor_directives is
  'One instruction, from the mentor to one man, for one week. Visible to those two only. No '
  'reply column — see the header of 0010 for why that absence is the design.';

create index if not exists directives_for_subject
  on public.mentor_directives (subject_id, week_start desc);

alter table public.mentor_directives enable row level security;
alter table public.mentor_directives force row level security;

-- Author or subject. Not the circle, and not other mentors.
drop policy if exists directives_select_involved on public.mentor_directives;
create policy directives_select_involved on public.mentor_directives
  for select to authenticated
  using (author_id = auth.uid() or subject_id = auth.uid());

-- Only a mentor writes one, only as himself, and only to someone in his own circle. The last
-- clause matters: without it a mentor could address a member of another circle, which is the
-- one thing `app.is_mentor()` alone would not stop.
drop policy if exists directives_insert_mentor on public.mentor_directives;
create policy directives_insert_mentor on public.mentor_directives
  for insert to authenticated
  with check (
    app.is_mentor()
    and author_id = auth.uid()
    and app.shares_my_circle(subject_id)
  );

-- Replacing what he said is allowed; editing it in place is not. A directive amended after the
-- man has read it means the two of them remember different instructions, and only one of them
-- can check. Delete-then-write is visible in `created_at`; an UPDATE would not be.
drop policy if exists directives_delete_author on public.mentor_directives;
create policy directives_delete_author on public.mentor_directives
  for delete to authenticated
  using (author_id = auth.uid());

grant select, insert, delete on public.mentor_directives to authenticated;

update public.app_meta set schema_version = 10, updated_at = now() where id;
