-- NOT A MIGRATION. Run once, by hand, on a fresh project.
--
-- Solves the chicken-and-egg problem: invitations can only be created by a mentor, and a
-- mentor can only exist by accepting an invitation. This is the one place that break is
-- made deliberately, as the owner, rather than left as a hole in the policies.
--
-- Safe to re-run at any stage: it reuses an existing circle, will not issue a second live
-- invitation, and does nothing at all once the mentor has joined. Verified by running it
-- three times across the join.
--
-- Change the email on the marked line before running.

do $$
declare
  v_circle_id uuid;
  -- CHANGE THIS to the mentor's email address. Lowercased because the database stores and
  -- compares lowercase — email case-sensitivity is how an invited man gets told he was not
  -- invited.
  v_email text := lower('you@example.com');
  v_circle_name text := 'The Circle';
begin
  select id into v_circle_id from public.circles order by created_at limit 1;
  if v_circle_id is null then
    insert into public.circles (name) values (v_circle_name) returning id into v_circle_id;
    raise notice 'created circle %', v_circle_id;
  else
    raise notice 'reusing existing circle %', v_circle_id;
  end if;

  if exists (
    select 1 from public.profiles
     where id in (select id from auth.users where email = v_email)
  ) then
    raise notice 'already a member, nothing to do';
    return;
  end if;

  if exists (select 1 from public.invitations where email = v_email and accepted_at is null) then
    raise notice 'a live invitation already exists for %', v_email;
    return;
  end if;

  insert into public.invitations (circle_id, email, role, token, expires_at)
  values (v_circle_id, v_email, 'mentor',
          encode(extensions.gen_random_bytes(16), 'hex'),
          now() + interval '14 days');
  raise notice 'invited % as mentor — now create the account for that address', v_email;
end
$$;
