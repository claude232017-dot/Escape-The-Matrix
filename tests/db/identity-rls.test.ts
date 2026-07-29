import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * Phase 1's central claim, tested rather than asserted: **the right men get in and nobody
 * else does.**
 *
 * Every query here runs as a real `authenticated` session with real JWT claims, so the
 * policies are exercised the way PostgREST exercises them. Reading the policies cannot
 * establish this: a policy that is syntactically fine and semantically wide open looks
 * identical in a diff to one that is correct.
 *
 * Given what this app stores per identified individual (§3.5), a gap here is an incident.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
  label: string;
}

describeDb('identity and circle isolation', () => {
  let client: Client;

  // Two circles, so "same circle" and "different circle" are both real cases. A test with
  // one circle cannot tell a correct policy from one that returns everything.
  let circleA: string;
  let circleB: string;
  let mentorA: Actor;
  let memberA: Actor;
  let memberA2: Actor;
  let mentorB: Actor;
  let memberB: Actor;

  /** Run `fn`'s SQL as an authenticated member, exactly as PostgREST would. */
  async function asMember<T>(actor: Actor | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await client.query('begin');
    try {
      const claims = actor
        ? JSON.stringify({ sub: actor.id, role: 'authenticated', email: actor.email })
        : JSON.stringify({ role: 'anon' });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`set local role ${actor ? 'authenticated' : 'anon'}`);
      const result = await client.query(sql, params);
      return result.rows as T[];
    } finally {
      // Always roll back: a test that leaves rows behind makes the next assertion lie.
      await client.query('rollback');
    }
  }

  /** Sign a man up the way GoTrue does — straight into auth.users. */
  async function signUp(email: string, meta: Record<string, string> = {}): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email.toLowerCase(), JSON.stringify(meta)],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error(`signUp did not return an id for ${email}`);
    return id;
  }

  async function invite(circleId: string, email: string, role = 'member'): Promise<void> {
    await client.query(
      `insert into public.invitations (circle_id, email, role, token, expires_at)
       values ($1, lower($2), $3::public.member_role, encode(extensions.gen_random_bytes(16), 'hex'),
               now() + interval '7 days')`,
      [circleId, email, role],
    );
  }

  beforeAll(async () => {
    await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    client = new Client({ connectionString: CONNECTION });
    await client.connect();

    const circles = await client.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle A'), ('Circle B') returning id`,
    );
    circleA = circles.rows[0]!.id;
    circleB = circles.rows[1]!.id;

    await invite(circleA, 'mentor-a@example.com', 'mentor');
    await invite(circleA, 'member-a@example.com');
    await invite(circleA, 'member-a2@example.com');
    await invite(circleB, 'mentor-b@example.com', 'mentor');
    await invite(circleB, 'member-b@example.com');

    mentorA = { id: await signUp('mentor-a@example.com'), email: 'mentor-a@example.com', label: 'mentor A' };
    memberA = { id: await signUp('member-a@example.com'), email: 'member-a@example.com', label: 'member A' };
    memberA2 = { id: await signUp('member-a2@example.com'), email: 'member-a2@example.com', label: 'member A2' };
    mentorB = { id: await signUp('mentor-b@example.com'), email: 'mentor-b@example.com', label: 'mentor B' };
    memberB = { id: await signUp('member-b@example.com'), email: 'member-b@example.com', label: 'member B' };
  }, 90_000);

  afterAll(async () => {
    await client?.end();
  });

  describe('signup', () => {
    it('creates a profile by trigger, with the invitation’s circle and role', async () => {
      const { rows } = await client.query<{ id: string; circle_id: string; role: string }>(
        `select id, circle_id, role from public.profiles order by created_at`,
      );
      expect(rows).toHaveLength(5);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(mentorA.id)?.circle_id).toBe(circleA);
      expect(byId.get(mentorA.id)?.role).toBe('mentor');
      expect(byId.get(memberA.id)?.role).toBe('member');
      expect(byId.get(memberB.id)?.circle_id).toBe(circleB);
    });

    it('refuses an uninvited address at the API boundary, not the form', async () => {
      // The success criterion, stated as an assertion: a direct insert into auth.users —
      // which is what GoTrue itself does — must be rejected.
      await expect(signUp('stranger@example.com')).rejects.toThrow(/signup_requires_invitation/);
    });

    it('leaves no orphaned auth user when signup is refused', async () => {
      // An auth user with no profile is an account that exists and cannot be used, and
      // which then reports "already registered" on retry with no way out.
      await expect(signUp('stranger2@example.com')).rejects.toThrow();
      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from auth.users u
          left join public.profiles p on p.id = u.id
         where p.id is null`,
      );
      expect(rows[0]?.count, 'auth users with no profile').toBe('0');
    });

    it('matches the invitation regardless of email case', async () => {
      // Email case-sensitivity is how an invited man gets told he was not invited.
      await invite(circleA, 'MiXeD@Example.COM');
      const id = await signUp('MIXED@EXAMPLE.COM');
      const { rows } = await client.query(`select id from public.profiles where id = $1`, [id]);
      expect(rows).toHaveLength(1);
    });

    it('refuses an expired invitation', async () => {
      await client.query(
        `insert into public.invitations (circle_id, email, token, created_at, expires_at)
         values ($1, 'expired@example.com', 'tok-expired-0000000000',
                 now() - interval '30 days', now() - interval '1 day')`,
        [circleA],
      );
      await expect(signUp('expired@example.com')).rejects.toThrow(/signup_requires_invitation/);
    });

    it('refuses a second signup on an already-accepted invitation', async () => {
      // The invitation is consumed, not merely checked. Otherwise one invitation is an
      // unlimited supply of accounts.
      await expect(signUp('member-a@example.com')).rejects.toThrow();
    });

    it('records the member’s timezone from signup metadata, and rejects nonsense', async () => {
      await invite(circleA, 'tz@example.com');
      const id = await signUp('tz@example.com', { timezone: 'America/New_York', display_name: 'TZ Man' });
      const { rows } = await client.query<{ timezone: string; display_name: string }>(
        `select timezone, display_name from public.profiles where id = $1`,
        [id],
      );
      expect(rows[0]?.timezone).toBe('America/New_York');
      expect(rows[0]?.display_name).toBe('TZ Man');

      await invite(circleA, 'badtz@example.com');
      const badId = await signUp('badtz@example.com', { timezone: 'Mars/Olympus_Mons' });
      const bad = await client.query<{ timezone: string }>(
        `select timezone from public.profiles where id = $1`,
        [badId],
      );
      // Falls back rather than failing: an uncreatable account is worse than a timezone
      // the member must confirm at onboarding anyway.
      expect(bad.rows[0]?.timezone).toBe('UTC');
    });
  });

  describe('cross-member isolation — the core claim', () => {
    it('lets a member see his own circle and only his own circle', async () => {
      const rows = await asMember<{ id: string; circle_id: string }>(
        memberA,
        `select id, circle_id from public.profiles`,
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.circle_id === circleA)).toBe(true);
      expect(rows.map((r) => r.id)).toContain(memberA2.id);
      expect(rows.map((r) => r.id)).not.toContain(memberB.id);
    });

    it('returns ZERO rows when member A targets member B directly', async () => {
      // Named target, not a filter over a list. This is the assertion the spec asks for.
      for (const [reader, target] of [
        [memberA, memberB],
        [memberB, memberA],
        [mentorA, memberB],
        [mentorB, memberA],
      ] as const) {
        const rows = await asMember(reader, `select id from public.profiles where id = $1`, [
          target.id,
        ]);
        expect(rows, `${reader.label} could read ${target.label}`).toEqual([]);
      }
    });

    it('returns ZERO rows for another circle', async () => {
      const rows = await asMember(memberA, `select id from public.circles where id = $1`, [circleB]);
      expect(rows).toEqual([]);
    });

    it('cannot UPDATE another member’s profile', async () => {
      const rows = await asMember(
        memberA,
        `update public.profiles set display_name = 'hacked' where id = $1 returning id`,
        [memberB.id],
      );
      expect(rows, 'member A updated member B').toEqual([]);

      // And confirm it really did not land.
      const check = await client.query<{ display_name: string }>(
        `select display_name from public.profiles where id = $1`,
        [memberB.id],
      );
      expect(check.rows[0]?.display_name).not.toBe('hacked');
    });

    it('cannot UPDATE a same-circle member’s profile either', async () => {
      // Same circle is not the same person. Visibility is not write access.
      const rows = await asMember(
        memberA,
        `update public.profiles set display_name = 'hacked' where id = $1 returning id`,
        [memberA2.id],
      );
      expect(rows).toEqual([]);
    });

    it('cannot DELETE any profile', async () => {
      // No DELETE policy exists, so the verb is denied outright.
      await expect(
        asMember(memberA, `delete from public.profiles where id = $1`, [memberA.id]),
      ).rejects.toThrow(/permission denied|policy/i);
    });

    it('cannot INSERT a profile', async () => {
      // Profiles are created only by the signup trigger. No INSERT policy, no grant.
      await expect(
        asMember(
          memberA,
          `insert into public.profiles (id, circle_id, display_name) values ($1, $2, 'ghost')`,
          [memberB.id, circleA],
        ),
      ).rejects.toThrow(/permission denied|policy/i);
    });

    it('cannot INSERT or UPDATE a circle', async () => {
      await expect(
        asMember(memberA, `insert into public.circles (name) values ('mine now')`),
      ).rejects.toThrow(/permission denied|policy/i);
      await expect(
        asMember(memberA, `update public.circles set name = 'mine now' where id = $1`, [circleA]),
      ).rejects.toThrow(/permission denied|policy/i);
    });
  });

  describe('privilege escalation', () => {
    it('cannot promote himself to mentor', async () => {
      // Enforced by the column-level grant, not a policy: WITH CHECK cannot see OLD, so a
      // policy claiming to prevent this would be theatre.
      await expect(
        asMember(memberA, `update public.profiles set role = 'mentor' where id = $1`, [memberA.id]),
      ).rejects.toThrow(/permission denied|column/i);
    });

    it('cannot move himself into another circle', async () => {
      await expect(
        asMember(memberA, `update public.profiles set circle_id = $1 where id = $2`, [
          circleB,
          memberA.id,
        ]),
      ).rejects.toThrow(/permission denied|column/i);
    });

    it('can still edit the fields that are his to edit', async () => {
      // The negative tests above are only meaningful if the positive case works.
      const rows = await asMember<{ display_name: string; timezone: string }>(
        memberA,
        `update public.profiles
            set display_name = 'Renamed', timezone = 'Europe/London', top_g_code = 'I am the cause.'
          where id = $1
          returning display_name, timezone`,
        [memberA.id],
      );
      expect(rows[0]?.display_name).toBe('Renamed');
      expect(rows[0]?.timezone).toBe('Europe/London');
    });

    it('cannot set an invalid timezone even on his own row', async () => {
      await expect(
        asMember(memberA, `update public.profiles set timezone = 'Nowhere/Fake' where id = $1`, [
          memberA.id,
        ]),
      ).rejects.toThrow(/profiles_timezone_valid/);
    });
  });

  describe('invitations', () => {
    it('is invisible to a member', async () => {
      const rows = await asMember(memberA, `select id from public.invitations`);
      expect(rows, 'a member could read the invitation list').toEqual([]);
    });

    it('is visible to the mentor of that circle only', async () => {
      const seenByA = await asMember<{ circle_id: string }>(
        mentorA,
        `select circle_id from public.invitations`,
      );
      expect(seenByA.length).toBeGreaterThan(0);
      expect(seenByA.every((r) => r.circle_id === circleA)).toBe(true);

      const crossCircle = await asMember(mentorA, `select id from public.invitations where circle_id = $1`, [
        circleB,
      ]);
      expect(crossCircle).toEqual([]);
    });

    it('can be created by the mentor, for his own circle', async () => {
      const rows = await asMember<{ id: string }>(
        mentorA,
        `insert into public.invitations (circle_id, email, token, expires_at)
         values ($1, 'newman@example.com', 'tok-newman-000000000000', now() + interval '7 days')
         returning id`,
        [circleA],
      );
      expect(rows).toHaveLength(1);
    });

    it('cannot be created by a member', async () => {
      // The whole invite-only mechanism collapses if any member can mint invitations.
      await expect(
        asMember(
          memberA,
          `insert into public.invitations (circle_id, email, token, expires_at)
           values ($1, 'smuggled@example.com', 'tok-smuggled-00000000', now() + interval '7 days')`,
          [circleA],
        ),
      ).rejects.toThrow(/permission denied|policy/i);
    });

    it('cannot be created by a mentor for a circle he is not in', async () => {
      await expect(
        asMember(
          mentorA,
          `insert into public.invitations (circle_id, email, token, expires_at)
           values ($1, 'crosscircle@example.com', 'tok-cross-0000000000', now() + interval '7 days')`,
          [circleB],
        ),
      ).rejects.toThrow(/permission denied|policy/i);
    });

    it('cannot be revoked by a member, but can by the mentor', async () => {
      const memberAttempt = await asMember(
        memberA,
        `delete from public.invitations where email = 'newman2@example.com' returning id`,
      );
      expect(memberAttempt).toEqual([]);

      await invite(circleA, 'revokeme@example.com');
      const mentorAttempt = await asMember<{ id: string }>(
        mentorA,
        `delete from public.invitations where email = 'revokeme@example.com' returning id`,
      );
      expect(mentorAttempt).toHaveLength(1);
    });

    it('allows only one live invitation per address', async () => {
      await invite(circleA, 'dupe@example.com');
      await expect(invite(circleA, 'dupe@example.com')).rejects.toThrow(
        /invitations_one_open_per_email/,
      );
    });

    it('rejects a malformed email and an uppercase one', async () => {
      await expect(
        client.query(
          `insert into public.invitations (circle_id, email, token, expires_at)
           values ($1, 'not-an-email', 'tok-bad-00000000000000', now() + interval '1 day')`,
          [circleA],
        ),
      ).rejects.toThrow(/invitations_email_shape/);

      await expect(
        client.query(
          `insert into public.invitations (circle_id, email, token, expires_at)
           values ($1, 'Upper@Example.com', 'tok-upper-000000000000', now() + interval '1 day')`,
          [circleA],
        ),
      ).rejects.toThrow(/invitations_email_lowercase/);
    });
  });

  describe('the anonymous surface', () => {
    it('does not exist', async () => {
      // There is no public signup and nothing to read without a session.
      for (const table of ['public.profiles', 'public.circles', 'public.invitations', 'public.app_meta']) {
        await expect(
          asMember(null, `select * from ${table} limit 1`),
          `anon could reach ${table}`,
        ).rejects.toThrow(/permission denied/i);
      }
    });
  });

  describe('the disclosure required by ADR-009', () => {
    it('starts unaccepted', async () => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.profiles
          where disclosure_accepted_at is not null`,
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('can be accepted by the member himself, with a version', async () => {
      const rows = await asMember<{ disclosure_version: string }>(
        memberA,
        `update public.profiles
            set disclosure_accepted_at = now(), disclosure_version = '2026.07-draft'
          where id = $1
          returning disclosure_version`,
        [memberA.id],
      );
      expect(rows[0]?.disclosure_version).toBe('2026.07-draft');
    });

    it('cannot record a timestamp with no version', async () => {
      // A timestamp with no version cannot answer "what did he actually agree to", which
      // is the only question it exists to answer.
      await expect(
        asMember(
          memberA,
          `update public.profiles set disclosure_accepted_at = now() where id = $1`,
          [memberA.id],
        ),
      ).rejects.toThrow(/profiles_disclosure_complete/);
    });
  });
});
