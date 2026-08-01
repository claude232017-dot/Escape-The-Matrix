-- 0012_export_and_deletion.sql — Phase 8
--
-- The two promises SECURITY.md §2 has been carrying since Phase 0: **export includes
-- everything, and deletion means deletion.**
--
-- ---------------------------------------------------------------------------
-- First, the constraint that made the second promise false
-- ---------------------------------------------------------------------------
-- `playbooks.promoted_by` was written in 0011 as ON DELETE RESTRICT. The intent was right —
-- losing a playbook because its promoter left would take other men's applications with it — but
-- RESTRICT is the wrong instrument, and the consequence is severe and silent:
--
--     delete from auth.users where id = <the mentor>
--     ERROR:  update or delete on table "profiles" violates foreign key constraint
--             "playbooks_promoted_by_fkey"
--
-- **A mentor who ever promoted a playbook could not be deleted at all.** Nobody would find that
-- out until someone asked to be erased, at which point the answer would be "the button does not
-- work", during the one conversation where that answer is unacceptable.
--
-- SET NULL is what was actually meant: keep the playbook and the applications hanging off it,
-- and forget who promoted it. Exactly what `promoted_from` already does when the source debrief
-- goes. The column loses NOT NULL because "promoted by somebody who has since been erased" is a
-- real state and the schema has to be able to hold it.
--
-- The insert policy still requires `promoted_by = auth.uid()`, so nothing can be created without
-- one. Only deletion produces the null.
alter table public.playbooks
  drop constraint if exists playbooks_promoted_by_fkey;

alter table public.playbooks
  alter column promoted_by drop not null;

alter table public.playbooks
  add constraint playbooks_promoted_by_fkey
  foreign key (promoted_by) references public.profiles (id) on delete set null;

comment on column public.playbooks.promoted_by is
  'Who promoted it. Null once that man has been erased — see 0012. Never null on insert: the '
  'policy requires promoted_by = auth.uid().';

-- ---------------------------------------------------------------------------
-- public.export_my_data — everything he owns, including the parts that are hard to read
-- ---------------------------------------------------------------------------
-- §3.5: "Export includes it." *It* is the sexual-discipline compliance, the substance use, and
-- the psychological profile — the material the rest of this schema works to keep from his peers.
-- An export that quietly omitted the sensitive half would be the most defensible-looking way to
-- break the promise, so this returns `bottom_g_tactics` and every protocol result in full.
--
-- SECURITY DEFINER because it reads across tables whose policies would otherwise each have to be
-- satisfied, and because the catalogue join needs protocols the member can read anyway. It takes
-- **no profile argument**: it reads `auth.uid()` and can only ever return the caller's own data.
-- That is the property that makes a DEFINER function safe here, and it is asserted in the tests.
--
-- The catalogue is included deliberately. An export full of `protocol_id` UUIDs is a file nobody
-- can read, and "you may have your data" is not honoured by handing someone a join key.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile uuid := auth.uid();
  v_out jsonb;
begin
  if v_profile is null then
    raise exception 'export_no_session' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'schema_version', (select am.schema_version from public.app_meta am limit 1),
    'doctrine_version', (select am.doctrine_version from public.app_meta am limit 1),

    'profile', (
      select to_jsonb(p) - 'circle_id'
        from public.profiles p where p.id = v_profile
    ),

    -- So the ids below mean something to a human reading the file.
    'catalogue', jsonb_build_object(
      'protocols', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'slug', pr.slug, 'label', pr.label, 'kind', pr.kind))
          from public.protocols pr
          join public.campaigns c on c.id = pr.campaign_id
          join public.enrollments e on e.campaign_id = c.id
         where e.profile_id = v_profile
      ), '[]'::jsonb),
      'business_actions', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'slug', a.slug, 'label', a.label))
          from public.business_actions a
          join public.profiles p on p.circle_id = a.circle_id
         where p.id = v_profile
      ), '[]'::jsonb)
    ),

    'enrollments', coalesce((
      select jsonb_agg(to_jsonb(e)) from public.enrollments e where e.profile_id = v_profile
    ), '[]'::jsonb),

    'sitreps', coalesce((
      select jsonb_agg(to_jsonb(s))
        from public.sitreps s
        join public.enrollments e on e.id = s.enrollment_id
       where e.profile_id = v_profile
    ), '[]'::jsonb),

    -- The whole point of §3.5. Itemised, not aggregated.
    'protocol_results', coalesce((
      select jsonb_agg(to_jsonb(r))
        from public.protocol_results r
        join public.sitreps s on s.id = r.sitrep_id
        join public.enrollments e on e.id = s.enrollment_id
       where e.profile_id = v_profile
    ), '[]'::jsonb),

    'reset_events', coalesce((
      select jsonb_agg(to_jsonb(x))
        from public.reset_events x
        join public.enrollments e on e.id = x.enrollment_id
       where e.profile_id = v_profile
    ), '[]'::jsonb),

    'debriefs', coalesce((
      select jsonb_agg(to_jsonb(d))
        from public.debriefs d
        join public.sitreps s on s.id = d.sitrep_id
        join public.enrollments e on e.id = s.enrollment_id
       where e.profile_id = v_profile
    ), '[]'::jsonb),

    -- The most sensitive table in the schema, and therefore the one an export must not skip.
    'bottom_g_tactics', coalesce((
      select jsonb_agg(to_jsonb(t))
        from public.bottom_g_tactics t
        join public.sitreps s on s.id = t.sitrep_id
        join public.enrollments e on e.id = s.enrollment_id
       where e.profile_id = v_profile
    ), '[]'::jsonb),

    'ventures', coalesce((
      select jsonb_agg(to_jsonb(v)) from public.ventures v where v.owner_id = v_profile
    ), '[]'::jsonb),

    'daily_business_entries', coalesce((
      select jsonb_agg(to_jsonb(d))
        from public.daily_business_entries d where d.profile_id = v_profile
    ), '[]'::jsonb),

    -- amount_minor is bigint; to_jsonb renders it as a JSON number, which is exact to 2^53 and
    -- therefore fine for any amount this app can hold. Stated because §3.2 forbids guessing.
    'money_entries', coalesce((
      select jsonb_agg(to_jsonb(m))
        from public.money_entries m
        join public.ventures v on v.id = m.venture_id
       where v.owner_id = v_profile
    ), '[]'::jsonb),

    'commitments', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.commitments c where c.profile_id = v_profile
    ), '[]'::jsonb),

    'weekly_reviews', coalesce((
      select jsonb_agg(to_jsonb(w)) from public.weekly_reviews w where w.profile_id = v_profile
    ), '[]'::jsonb),

    'playbook_applications', coalesce((
      select jsonb_agg(to_jsonb(a))
        from public.playbook_applications a where a.profile_id = v_profile
    ), '[]'::jsonb),

    -- Written *to* him. The ones he wrote are about other men and are not his to take.
    'directives_received', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_start', md.week_start, 'body', md.body, 'created_at', md.created_at))
        from public.mentor_directives md where md.subject_id = v_profile
    ), '[]'::jsonb)
  )
  into v_out;

  return v_out;
end
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

comment on function public.export_my_data() is
  'Everything the caller owns, as one JSON document, including the special-category detail. '
  'Takes no argument and reads auth.uid(), so it can only ever return his own.';

-- ---------------------------------------------------------------------------
-- public.delete_my_account — and it means it
-- ---------------------------------------------------------------------------
-- Deletes the row in `auth.users`, which cascades through `profiles` to every table that holds
-- anything about him. Nothing is soft-deleted, nothing is anonymised in place, and no tombstone
-- is kept: §2 says deletion means deletion, and a `deleted_at` column would make that sentence
-- false while looking responsible.
--
-- SECURITY DEFINER, because `auth.users` belongs to GoTrue and no member role can touch it. That
-- makes this the most dangerous function in the schema, so it is built to be safe by
-- construction rather than by care:
--
--   * **No profile argument.** It reads `auth.uid()`. There is no parameter through which a
--     caller could name somebody else, and the tests assert the signature so that the obvious
--     future "helpful" change is caught.
--   * **An emailed confirmation.** The caller must pass his own address exactly. This is the
--     database's own are-you-sure — a UI confirmation is decoration (§3.3), and an RPC that
--     erases a man's month on a single mis-tap does not deserve to be one call away.
--
-- What survives, and why it is not his: playbooks he promoted (SET NULL above) stay, because
-- other men adopted them and their applications are their own record. Invitations he sent lose
-- their `invited_by` for the same reason. Neither carries anything about him but a foreign key
-- that is now null.
create or replace function public.delete_my_account(p_confirm_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := auth.uid();
  v_email text;
begin
  if v_profile is null then
    raise exception 'delete_no_session' using errcode = '42501';
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile;
  if v_email is null then
    raise exception 'delete_no_account' using errcode = '23503';
  end if;

  -- Compared case-insensitively and trimmed, because the guard exists to stop an accident, not
  -- to test his typing. It still cannot be satisfied by anyone who does not know the address.
  if lower(btrim(coalesce(p_confirm_email, ''))) <> lower(v_email) then
    raise exception 'delete_confirmation_mismatch'
      using errcode = 'P0001',
            hint = 'Type your own email address exactly to confirm. This cannot be undone.';
  end if;

  delete from auth.users where id = v_profile;

  return jsonb_build_object('deleted', true);
end
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

comment on function public.delete_my_account(text) is
  'Erases the caller. Cascades from auth.users through profiles to every table. Requires his '
  'own email as confirmation; takes no profile argument, so it can only ever erase himself.';

update public.app_meta set schema_version = 12, updated_at = now() where id;
