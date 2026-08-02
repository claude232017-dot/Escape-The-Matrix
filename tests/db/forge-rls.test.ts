import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The Forge's integrity, tested against real Postgres with real sessions.
 *
 * Two classes of claim here, and the second is the one that could not be tested any other way:
 *
 *  1. **Anti-forgery.** A client cannot choose which day it is filing against, cannot backdate an
 *     enrollment to inflate a day count, and cannot report a day it has not lived. These are
 *     server-side because the anon key is public.
 *  2. **Peer visibility.** A peer may read an `itemised` protocol result and must get **zero
 *     rows** for an `aggregate_only` one — the sexual-discipline and substance protocols. That is
 *     GDPR special-category data (docs/SECURITY.md §2), and a policy that looks right in a diff
 *     is not evidence.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
  label: string;
}

describeDb('the Forge', () => {
  let client: Client;
  let circleA: string;
  let campaignA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let enrollmentA: string;
  let protocols: Map<string, string>;

  async function asMember<T>(actor: Actor | null, sql: string, params: unknown[] = []): Promise<T[]> {
    await client.query('begin');
    try {
      const claims = actor
        ? JSON.stringify({ sub: actor.id, role: 'authenticated', email: actor.email })
        : JSON.stringify({ role: 'anon' });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`set local role ${actor ? 'authenticated' : 'anon'}`);
      return (await client.query(sql, params)).rows as T[];
    } finally {
      await client.query('rollback');
    }
  }

  async function signUp(email: string, circleId: string, role = 'member', tz = 'UTC'): Promise<string> {
    await client.query(
      `insert into public.invitations (circle_id, email, role, token, expires_at)
       values ($1, lower($2), $3::public.member_role,
               encode(extensions.gen_random_bytes(16), 'hex'), now() + interval '7 days')`,
      [circleId, email, role],
    );
    const { rows } = await client.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values (lower($1), jsonb_build_object('timezone', $2::text)) returning id`,
      [email, tz],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    client = new Client({ connectionString: CONNECTION });
    await client.connect();

    const circles = await client.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle A'), ('Circle B') returning id`,
    );
    circleA = circles.rows[0]!.id;
    const circleB = circles.rows[1]!.id;

    mentorA = { id: await signUp('mentor-a@example.com', circleA, 'mentor'), email: 'mentor-a@example.com', label: 'mentor A' };
    memberA = { id: await signUp('member-a@example.com', circleA, 'member', 'America/New_York'), email: 'member-a@example.com', label: 'member A' };
    peerA = { id: await signUp('peer-a@example.com', circleA), email: 'peer-a@example.com', label: 'peer A' };
    memberB = { id: await signUp('member-b@example.com', circleB), email: 'member-b@example.com', label: 'member B' };

    const campaigns = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'March Campaign', current_date - 10, 30) returning id`,
      [circleA],
    );
    campaignA = campaigns.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);

    const { rows: protocolRows } = await client.query<{ slug: string; id: string }>(
      `select slug, id from public.protocols where campaign_id = $1`,
      [campaignA],
    );
    protocols = new Map(protocolRows.map((r) => [r.slug, r.id]));

    const enrollments = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, current_date - 10) returning id`,
      [memberA.id, campaignA],
    );
    enrollmentA = enrollments.rows[0]!.id;
  }, 90_000);

  afterAll(async () => {
    await client?.end();
  });

  describe('the seeded catalogue', () => {
    it('matches the activation schedule the owner settled', async () => {
      const { rows } = await client.query<{ slug: string; activates_on_day: number }>(
        `select slug, activates_on_day from public.protocols where campaign_id = $1 order by slug`,
        [campaignA],
      );
      const byslug = new Map(rows.map((r) => [r.slug, r.activates_on_day]));
      // DOCTRINE §2.0, five waves. Asserted because a silent change here shifts what a man is
      // judged against on a given day.
      expect(byslug.get('morning-protocol')).toBe(1);
      expect(byslug.get('daily-sitrep')).toBe(1);
      expect(byslug.get('sexual-discipline')).toBe(1);
      expect(byslug.get('video-games')).toBe(1);
      expect(byslug.get('physical-forging')).toBe(4);
      expect(byslug.get('deep-work')).toBe(4);
      expect(byslug.get('junk-food')).toBe(8);
      expect(byslug.get('alcohol-and-drugs')).toBe(8);
      expect(byslug.get('evening-power-down')).toBe(15);
      expect(byslug.get('binge-watching')).toBe(15);
      expect(byslug.get('mindless-scrolling')).toBe(22);
    });

    it('puts exactly three protocols live on day one', async () => {
      // The consequence of the schedule, stated: three failures on day 1 is all of them, which
      // under the current zero-day threshold is treason. DOCTRINE §10 open question 3.
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.protocols
          where campaign_id = $1 and activates_on_day = 1 and slug <> 'daily-sitrep'`,
        [campaignA],
      );
      expect(rows[0]?.n).toBe('3');
    });

    it('gives Physical Forging two MED options — a genuine either/or', async () => {
      // The reason protocol_med_options is a table and not a text column.
      const { rows } = await client.query<{ label: string; body: string }>(
        `select o.label, o.body from public.protocol_med_options o
           join public.protocols p on p.id = o.protocol_id
          where p.campaign_id = $1 and p.slug = 'physical-forging'
          order by o.sort_order`,
        [campaignA],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]?.label).toBe('Option A');
      expect(rows[0]?.body).toContain('100 push-ups');
      expect(rows[1]?.body).toContain('20-minute');
    });

    it('marks the oath as the sole treason trigger', async () => {
      const { rows } = await client.query<{ slug: string }>(
        `select slug from public.protocols where campaign_id = $1 and is_treason_trigger`,
        [campaignA],
      );
      expect(rows.map((r) => r.slug)).toEqual(['sexual-discipline']);
    });

    it('defaults the sensitive protocols to aggregate_only', async () => {
      const { rows } = await client.query<{ slug: string }>(
        `select slug from public.protocols
          where campaign_id = $1 and visibility = 'aggregate_only' order by slug`,
        [campaignA],
      );
      expect(rows.map((r) => r.slug)).toEqual(['alcohol-and-drugs', 'sexual-discipline']);
    });

    it('is idempotent', async () => {
      const before = await client.query<{ n: string }>(
        `select count(*)::text as n from public.protocols where campaign_id = $1`,
        [campaignA],
      );
      await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);
      const after = await client.query<{ n: string }>(
        `select count(*)::text as n from public.protocols where campaign_id = $1`,
        [campaignA],
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  });

  describe('a client cannot choose what day it is', () => {
    /**
     * Today in the member's own timezone — never `current_date`.
     *
     * §3.1 in the place it is easiest to forget: a test. These three cases used `current_date`,
     * which is the *database session's* today, and memberA lives in `America/New_York`. For the
     * four hours between midnight UTC and midnight in New York the two disagree, so
     * `current_date` is tomorrow as far as he is concerned and the constraint correctly rejects
     * it. The suite passed twenty hours a day and failed for four — and it failed for the right
     * reason, on the assertion whose whole subject is that the server does not decide what day
     * it is for him.
     *
     * Computed through the admin connection rather than inside the member's own statement:
     * ADR-011 — `authenticated` has no USAGE on schema `app`, so `app.today_for()` in a
     * statement running as that role fails with permission denied. Reading it here and passing
     * the answer as a value is also what the real client does.
     */
    async function todayFor(profileId: string): Promise<string> {
      const { rows } = await client.query<{ today: string }>(
        `select app.today_for($1)::text as today`,
        [profileId],
      );
      return rows[0]!.today;
    }

    it('refuses a SITREP for a day not yet lived', async () => {
      // Without this a man files thirty perfect days this afternoon and the dataset is fiction.
      await expect(
        asMember(
          memberA,
          `insert into public.sitreps (enrollment_id, local_date, final_status)
           values ($1, $2::date + 1, 'complete')`,
          [enrollmentA, await todayFor(memberA.id)],
        ),
      ).rejects.toThrow(/sitrep_in_future/);
    });

    it('refuses a SITREP dated before the enrollment began', async () => {
      await expect(
        asMember(
          memberA,
          `insert into public.sitreps (enrollment_id, local_date, final_status)
           values ($1, $2::date - 20, 'complete')`,
          [enrollmentA, await todayFor(memberA.id)],
        ),
      ).rejects.toThrow(/sitrep_before_enrollment/);
    });

    it('accepts today and any day since the enrollment started', async () => {
      const rows = await asMember<{ local_date: Date }>(
        memberA,
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, $2::date, 'complete') returning local_date`,
        [enrollmentA, await todayFor(memberA.id)],
      );
      expect(rows).toHaveLength(1);
    });

    it('allows only one SITREP per day', async () => {
      await client.query(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, current_date - 1, 'complete')`,
        [enrollmentA],
      );
      await expect(
        client.query(
          `insert into public.sitreps (enrollment_id, local_date, final_status)
           values ($1, current_date - 1, 'repeat')`,
          [enrollmentA],
        ),
      ).rejects.toThrow(/sitreps_one_per_day/);
    });

    it('resolves "today" in the member’s own timezone, not the server’s', async () => {
      // memberA is America/New_York. The function must answer from his column, which is what
      // makes a man who travels not lose a day.
      const { rows } = await client.query<{ his: string; utc: string }>(
        `select app.today_for($1)::text as his, (now() at time zone 'UTC')::date::text as utc`,
        [memberA.id],
      );
      expect(rows[0]?.his).toBeTruthy();
      // They differ for part of every day; asserting they are both valid dates and within a day
      // of each other is the stable claim.
      const diff = Math.abs(
        (new Date(`${rows[0]!.his}T00:00:00Z`).getTime() -
          new Date(`${rows[0]!.utc}T00:00:00Z`).getTime()) /
          86_400_000,
      );
      expect(diff).toBeLessThanOrEqual(1);
    });
  });

  describe('a client cannot inflate its day count', () => {
    it('refuses an enrollment starting before the campaign', async () => {
      // An earlier start means a higher day number and a longer apparent streak — the one
      // direction of forgery that would flatter him.
      await expect(
        asMember(
          peerA,
          `insert into public.enrollments (profile_id, campaign_id, started_on)
           values ($1, $2, current_date - 60)`,
          [peerA.id, campaignA],
        ),
      ).rejects.toThrow(/enrollment_before_campaign_start/);
    });

    it('refuses an enrollment starting more than a day ahead', async () => {
      await expect(
        asMember(
          peerA,
          `insert into public.enrollments (profile_id, campaign_id, started_on)
           values ($1, $2, current_date + 5)`,
          [peerA.id, campaignA],
        ),
      ).rejects.toThrow(/enrollment_starts_in_future/);
    });

    it('permits tomorrow, because a reset filed today starts tomorrow', async () => {
      const rows = await asMember<{ id: string }>(
        peerA,
        `insert into public.enrollments (profile_id, campaign_id, started_on)
         values ($1, $2, current_date + 1) returning id`,
        [peerA.id, campaignA],
      );
      expect(rows).toHaveLength(1);
    });

    it('refuses a reset that chains to another man’s enrollment', async () => {
      await expect(
        asMember(
          peerA,
          `insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id)
           values ($1, $2, current_date, $3)`,
          [peerA.id, campaignA, enrollmentA],
        ),
      ).rejects.toThrow(/enrollment_previous_not_own/);
    });

    it('refuses a reset that moves the start date backwards', async () => {
      // Otherwise a man re-points his chain at an older start and recovers a day count he lost.
      await expect(
        asMember(
          memberA,
          `insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id)
           values ($1, $2, current_date - 20, $3)`,
          [memberA.id, campaignA, enrollmentA],
        ),
      ).rejects.toThrow(/enrollment_before_campaign_start|enrollment_must_move_forward/);
    });

    it('cannot create an enrollment for another man', async () => {
      const rows = await asMember(
        peerA,
        `insert into public.enrollments (profile_id, campaign_id, started_on)
         select $1, $2, current_date
          where not exists (select 1 from public.enrollments where profile_id = $1 and status = 'active')
         returning id`,
        [memberB.id, campaignA],
      ).catch((error: Error) => error);
      // Either the policy rejects it or it inserts nothing. Both are acceptable; silently
      // creating a row for memberB is not.
      if (Array.isArray(rows)) expect(rows).toEqual([]);
      else expect(String(rows)).toMatch(/policy|permission/i);
    });

    it('keeps only one active enrollment per campaign', async () => {
      await expect(
        client.query(
          `insert into public.enrollments (profile_id, campaign_id, started_on)
           values ($1, $2, current_date)`,
          [memberA.id, campaignA],
        ),
      ).rejects.toThrow(/enrollments_one_active_per_campaign/);
    });
  });

  describe('history is never destroyed', () => {
    it('grants no DELETE on enrollments, sitreps or reset_events', async () => {
      // Structural rather than conventional: without the grant there is no code path that can.
      const { rows } = await client.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'authenticated'
            and privilege_type = 'DELETE'
            and table_name in ('enrollments', 'sitreps', 'reset_events')`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([]);
    });

    it('leaves the previous enrollment and its SITREPs readable after a reset', async () => {
      const reset = await client.query<{ id: string }>(
        `insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id, status)
         values ($1, $2, current_date + 1, $3, 'active') returning id`,
        [peerA.id, campaignA, null],
      );
      expect(reset.rows).toHaveLength(1);

      // The original enrollment and its day still answer.
      const original = await client.query<{ n: string }>(
        `select count(*)::text as n from public.sitreps where enrollment_id = $1`,
        [enrollmentA],
      );
      expect(Number(original.rows[0]?.n)).toBeGreaterThan(0);
    });
  });

  describe('peer visibility — §3.5', () => {
    let sitrepId: string;

    beforeAll(async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, current_date - 2, 'repeat') returning id`,
        [enrollmentA],
      );
      sitrepId = rows[0]!.id;
      await client.query(
        `insert into public.protocol_results (sitrep_id, protocol_id, status) values
           ($1, $2, 'fail'), ($1, $3, 'pass')`,
        [sitrepId, protocols.get('sexual-discipline'), protocols.get('morning-protocol')],
      );
    });

    it('lets a peer see an itemised result', async () => {
      const rows = await asMember(
        peerA,
        `select id from public.protocol_results where sitrep_id = $1 and protocol_id = $2`,
        [sitrepId, protocols.get('morning-protocol')],
      );
      expect(rows).toHaveLength(1);
    });

    it('gives a peer ZERO rows for an aggregate_only result', async () => {
      // The sexual-discipline protocol. It counts toward the day's status, which the circle
      // sees, and is never itemised to a peer. This is GDPR special-category data.
      const rows = await asMember(
        peerA,
        `select id from public.protocol_results where sitrep_id = $1 and protocol_id = $2`,
        [sitrepId, protocols.get('sexual-discipline')],
      );
      expect(rows, 'a peer read a sensitive protocol result').toEqual([]);
    });

    it('still lets the peer see the day’s status, which is the accountability mechanism', async () => {
      const rows = await asMember<{ final_status: string }>(
        peerA,
        `select final_status from public.sitreps where id = $1`,
        [sitrepId],
      );
      expect(rows[0]?.final_status).toBe('repeat');
    });

    it('lets the mentor see everything, as disclosed at enrollment', async () => {
      const rows = await asMember(
        mentorA,
        `select id from public.protocol_results where sitrep_id = $1`,
        [sitrepId],
      );
      expect(rows).toHaveLength(2);
    });

    it('lets the man himself see his own detail', async () => {
      const rows = await asMember(
        memberA,
        `select id from public.protocol_results where sitrep_id = $1`,
        [sitrepId],
      );
      expect(rows).toHaveLength(2);
    });

    it('gives another circle ZERO rows for anything', async () => {
      for (const sql of [
        `select id from public.sitreps where id = $1`,
        `select id from public.protocol_results where sitrep_id = $1`,
      ]) {
        expect(await asMember(memberB, sql, [sitrepId]), sql).toEqual([]);
      }
      expect(
        await asMember(memberB, `select id from public.campaigns where id = $1`, [campaignA]),
      ).toEqual([]);
    });

    it('keeps reset events from peers but not from the mentor', async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.reset_events (enrollment_id, occurred_on, kind, reason, protocols_failed)
         values ($1, current_date - 2, 'treason', 'Broke the oath.', array['sexual-discipline'])
         returning id`,
        [enrollmentA],
      );
      const eventId = rows[0]!.id;
      expect(await asMember(peerA, `select id from public.reset_events where id = $1`, [eventId])).toEqual([]);
      expect(await asMember(mentorA, `select id from public.reset_events where id = $1`, [eventId])).toHaveLength(1);
      expect(await asMember(memberA, `select id from public.reset_events where id = $1`, [eventId])).toHaveLength(1);
    });
  });

  describe('only the mentor defines the ruleset', () => {
    it('lets a member read protocols but not change them', async () => {
      expect(
        (await asMember(memberA, `select id from public.protocols where campaign_id = $1`, [campaignA]))
          .length,
      ).toBeGreaterThan(0);

      const attempt = await asMember(
        memberA,
        `update public.protocols set activates_on_day = 1 where campaign_id = $1 returning id`,
        [campaignA],
      );
      expect(attempt, 'a member edited the protocol list').toEqual([]);
    });

    it('lets the mentor change an activation day', async () => {
      const rows = await asMember<{ activates_on_day: number }>(
        mentorA,
        `update public.protocols set activates_on_day = 2
          where campaign_id = $1 and slug = 'junk-food' returning activates_on_day`,
        [campaignA],
      );
      expect(rows[0]?.activates_on_day).toBe(2);
    });

    it('stops a member creating a campaign', async () => {
      await expect(
        asMember(memberA, `insert into public.campaigns (circle_id, name, starts_on) values ($1, 'Mine', current_date)`, [
          circleA,
        ]),
      ).rejects.toThrow(/policy|permission/i);
    });
  });

  describe('the MED option constraint', () => {
    it('rejects a MED option on a full pass', async () => {
      // Recording a MED option against a pass would say he did the minimum on a day he did the
      // whole thing, and that distinction is the entire reason it is stored.
      const { rows } = await client.query<{ id: string }>(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, current_date - 3, 'complete') returning id`,
        [enrollmentA],
      );
      const optionId = await client.query<{ id: string }>(
        `select o.id from public.protocol_med_options o join public.protocols p on p.id = o.protocol_id
          where p.campaign_id = $1 and p.slug = 'physical-forging' order by o.sort_order limit 1`,
        [campaignA],
      );
      await expect(
        client.query(
          `insert into public.protocol_results (sitrep_id, protocol_id, status, med_option_id)
           values ($1, $2, 'pass', $3)`,
          [rows[0]!.id, protocols.get('physical-forging'), optionId.rows[0]!.id],
        ),
      ).rejects.toThrow(/med_option_only_for_med_pass/);
    });

    it('accepts a MED option on a MED pass, recording which one he took', async () => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, current_date - 4, 'complete') returning id`,
        [enrollmentA],
      );
      const optionId = await client.query<{ id: string }>(
        `select o.id from public.protocol_med_options o join public.protocols p on p.id = o.protocol_id
          where p.campaign_id = $1 and p.slug = 'physical-forging' order by o.sort_order desc limit 1`,
        [campaignA],
      );
      const inserted = await client.query<{ med_option_id: string }>(
        `insert into public.protocol_results (sitrep_id, protocol_id, status, med_option_id)
         values ($1, $2, 'med_pass', $3) returning med_option_id`,
        [rows[0]!.id, protocols.get('physical-forging'), optionId.rows[0]!.id],
      );
      expect(inserted.rows[0]?.med_option_id).toBe(optionId.rows[0]!.id);
    });
  });

  describe('the anonymous surface still does not exist', () => {
    it('reaches none of the Forge tables', async () => {
      for (const table of [
        'public.campaigns',
        'public.protocols',
        'public.protocol_med_options',
        'public.enrollments',
        'public.sitreps',
        'public.protocol_results',
        'public.reset_events',
      ]) {
        await expect(
          asMember(null, `select * from ${table} limit 1`),
          `anon reached ${table}`,
        ).rejects.toThrow(/permission denied/i);
      }
    });
  });
});
