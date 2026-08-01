import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * Phase 6: the grain the correlation reads, and the weekly review that freezes it.
 *
 * The claim worth the most in this file is **the view degrades per role**. `member_days` puts
 * the Forge and the Ledger on one row, and those two halves have different audiences: a peer
 * may see whether a man's day held, and may not see a penny of his revenue. Because the view is
 * `security_invoker`, the policies underneath do that automatically — the same query returns the
 * day with the money blanked, rather than returning nothing or returning everything.
 *
 * That is a property nobody would notice was broken. A view left at the Postgres default runs as
 * its owner, hands a peer the revenue column, and looks completely normal doing it.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('the Commander’s View', () => {
  let client: Client;
  let circleA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let monday: string;
  let todayA: string;
  let isoDow: number;

  async function asMember<T>(
    actor: Actor | null,
    body: (query: (sql: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>,
  ): Promise<T> {
    await client.query('begin');
    try {
      const claims = actor
        ? JSON.stringify({ sub: actor.id, role: 'authenticated', email: actor.email })
        : JSON.stringify({ role: 'anon' });
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await client.query(`set local role ${actor ? 'authenticated' : 'anon'}`);
      return await body(async (sql, params = []) => (await client.query(sql, params)).rows);
    } finally {
      await client.query('rollback');
    }
  }

  /**
   * As a member, but **without** the surrounding rollback.
   *
   * `asMember` above rolls back on purpose: a read-only probe should leave nothing behind. But
   * the weekly-review tests need what the RPC wrote to still be there afterwards, so that the
   * snapshot can be inspected as the owner. Rolled back, every one of them asserted against a
   * row that had already vanished — which reads as "the function did nothing" rather than "the
   * test threw the result away".
   */
  async function asMemberCommitting<T>(
    actor: Actor,
    body: (query: (sql: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>,
  ): Promise<T> {
    const claims = JSON.stringify({ sub: actor.id, role: 'authenticated', email: actor.email });
    await client.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
    await client.query(`set role authenticated`);
    try {
      return await body(async (sql, params = []) => (await client.query(sql, params)).rows);
    } finally {
      await client.query('reset role');
      await client.query(`select set_config('request.jwt.claims', '', false)`);
    }
  }

  async function signUp(email: string, circleId: string, role = 'member'): Promise<Actor> {
    await client.query(
      `insert into public.invitations (circle_id, email, role, token, expires_at)
       values ($1, lower($2), $3::public.member_role,
               encode(extensions.gen_random_bytes(16), 'hex'), now() + interval '7 days')`,
      [circleId, email, role],
    );
    const { rows } = await client.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values (lower($1), jsonb_build_object('timezone', 'UTC')) returning id`,
      [email],
    );
    return { id: rows[0]!.id, email };
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

    mentorA = await signUp('mentor-a@example.com', circleA, 'mentor');
    memberA = await signUp('member-a@example.com', circleA);
    peerA = await signUp('peer-a@example.com', circleA);
    memberB = await signUp('member-b@example.com', circleB);

    const campaign = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'August Campaign', current_date - 20, 30) returning id`,
      [circleA],
    );
    const campaignA = campaign.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);
    await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);

    const dates = await client.query<{ monday: string; today: string; dow: string }>(
      `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday,
              to_char(app.today_for($1), 'YYYY-MM-DD') as today,
              extract(isodow from app.today_for($1))::text as dow`,
      [memberA.id],
    );
    monday = dates.rows[0]!.monday;
    todayA = dates.rows[0]!.today;
    isoDow = Number(dates.rows[0]!.dow);

    const enrollment = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 10) returning id`,
      [memberA.id, campaignA],
    );
    const enrollmentA = enrollment.rows[0]!.id;

    // A held day with four deep work blocks and a payment, plus a reset day with nothing —
    // which is exactly the shape the correlation is meant to be able to tell apart.
    await client.query(
      `insert into public.sitreps (enrollment_id, local_date, final_status)
       values ($1, $2::date, 'complete'), ($1, $2::date - 1, 'reset')`,
      [enrollmentA, todayA],
    );

    const venture = await client.query<{ id: string }>(
      `insert into public.ventures (owner_id, name, kind, started_on)
       values ($1, 'Consultancy', 'B2B services', app.today_for($1) - 10) returning id`,
      [memberA.id],
    );
    const ventureA = venture.rows[0]!.id;

    await client.query(
      `insert into public.daily_business_entries (profile_id, venture_id, action_id, local_date, count)
       select $1, $2, a.id, $3::date, 4 from public.business_actions a
        where a.circle_id = $4 and a.slug = 'deep-work-blocks'`,
      [memberA.id, ventureA, todayA, circleA],
    );
    await client.query(
      `insert into public.daily_business_entries (profile_id, venture_id, action_id, local_date, count)
       select $1, $2, a.id, $3::date, 3 from public.business_actions a
        where a.circle_id = $4 and a.slug = 'offers-made'`,
      [memberA.id, ventureA, todayA, circleA],
    );
    await client.query(
      `insert into public.money_entries
         (id, venture_id, occurred_on, direction, amount_minor, currency, category)
       values (extensions.gen_random_uuid(), $1, $2::date, 'in', 125000, 'GBP', 'sale')`,
      [ventureA, todayA],
    );
  }, 90_000);

  afterAll(async () => {
    await client?.end();
  });

  describe('member_days puts both loops on one row', () => {
    it('joins the day, the work and the money without fanning out', async () => {
      // Two business-action rows and one payment on the same day. A plain join would return
      // two rows and double the revenue — the kind of wrong number nobody checks.
      const rows = await asMember(memberA, (query) =>
        query(
          `select final_status, deep_work_blocks, business_actions,
                  revenue_minor::text as revenue_minor, currency, currency_count
             from public.member_days where local_date = $1::date`,
          [todayA],
        ),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        final_status: 'complete',
        deep_work_blocks: 4,
        business_actions: 7,
        revenue_minor: '125000',
        currency: 'GBP',
        currency_count: 1,
      });
    });

    it('reports a day with nothing on it as zero rather than null', async () => {
      const rows = (await asMember(memberA, (query) =>
        query(
          `select deep_work_blocks, business_actions, revenue_minor::text as revenue_minor
             from public.member_days where local_date = $1::date - 1`,
          [todayA],
        ),
      )) as { deep_work_blocks: number; business_actions: number; revenue_minor: string }[];
      expect(rows[0]).toEqual({
        deep_work_blocks: 0,
        business_actions: 0,
        revenue_minor: '0',
      });
    });

    it('covers only days he reported on', async () => {
      // Built on `sitreps`, deliberately. A day with no SITREP has no status, so it cannot
      // answer "did he hold the line", and inventing one would be inventing data.
      const rows = await asMember(memberA, (query) =>
        query(`select local_date from public.member_days`),
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe('the view degrades per role, because it is security_invoker', () => {
    it('shows a peer the day but blanks the money', async () => {
      // The property the whole design rests on. A peer may see whether a man's day held —
      // that is what the circle is for — and may not see a penny of his revenue. Both come
      // back through the *same* query, because the policies underneath do the work.
      const rows = (await asMember(peerA, (query) =>
        query(
          `select final_status, business_actions, revenue_minor::text as revenue_minor,
                  currency_count
             from public.member_days where local_date = $1::date`,
          [todayA],
        ),
      )) as {
        final_status: string;
        business_actions: number;
        revenue_minor: string;
        currency_count: number;
      }[];

      expect(rows, 'a peer could not see the day at all').toHaveLength(1);
      expect(rows[0]?.final_status).toBe('complete');
      // Effort is comparable; amounts are not. ADR-013's line, holding through a view.
      expect(rows[0]?.revenue_minor, 'a peer read another man’s revenue').toBe('0');
      expect(rows[0]?.currency_count).toBe(0);
    });

    it('shows the mentor everything, as disclosed', async () => {
      const rows = (await asMember(mentorA, (query) =>
        query(
          `select revenue_minor::text as revenue_minor, deep_work_blocks
             from public.member_days where local_date = $1::date`,
          [todayA],
        ),
      )) as { revenue_minor: string; deep_work_blocks: number }[];
      expect(rows[0]?.revenue_minor).toBe('125000');
      expect(rows[0]?.deep_work_blocks).toBe(4);
    });

    it('gives another circle zero rows', async () => {
      const rows = await asMember(memberB, (query) =>
        query(`select * from public.member_days`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });

    it('gives anon zero rows', async () => {
      const rows = await asMember(null, (query) =>
        query(`select * from public.member_days`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });
  });

  describe('public.file_weekly_review', () => {
    async function settleAll(): Promise<void> {
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 7, 'Ten sales calls', $2::date - 7)`,
        [memberA.id, monday],
      );
      await client.query(
        `update public.commitments set outcome = 'hit' where profile_id = $1`,
        [memberA.id],
      );
    }

    it('refuses while a commitment is still unanswered', async () => {
      // DOCTRINE §8: "A weekly review cannot be submitted with commitments still unresolved."
      // A review over an unanswered week is fiction, and this is the only place the rule can
      // live — it is a claim about a set of other rows.
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 7, 'Unanswered', $2::date - 7)`,
        [memberA.id, monday],
      );
      await asMember(memberA, async (query) => {
        await expect(
          query(`select public.file_weekly_review($1::date - 7, 'a', 'b', 'c')`, [monday]),
        ).rejects.toThrow(/review_commitments_unresolved/);
      });
      await client.query(`delete from public.commitments where profile_id = $1`, [memberA.id]);
    });

    it('refuses a week that is not over yet', async () => {
      await asMember(memberA, async (query) => {
        const filing = query(`select public.file_weekly_review($1::date, 'a', 'b', 'c')`, [monday]);
        if (isoDow < 7) {
          await expect(filing).rejects.toThrow(/review_too_early/);
        } else {
          await expect(filing).resolves.toBeTruthy();
        }
      });
    });

    it('computes the snapshot rather than accepting one', async () => {
      // The function takes three text fields and nothing else. There is no argument through
      // which a flattering number could arrive, which is the entire reason it is an RPC and
      // the table has no insert policy.
      const { rows } = await client.query<{ args: string }>(
        `select pg_get_function_arguments(p.oid) as args
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'file_weekly_review'`,
      );
      expect(rows[0]?.args).toBe(
        'p_week_start date, p_what_worked text, p_what_did_not text, p_next_week text',
      );
    });

    it('freezes the numbers as they were', async () => {
      await settleAll();
      const written = (await asMemberCommitting(memberA, (query) =>
        query(`select public.file_weekly_review($1::date - 7, 'Shipped it', null, 'More calls')`, [
          monday,
        ]),
      )) as { file_weekly_review: { created: boolean } }[];
      expect(written[0]?.file_weekly_review.created).toBe(true);

      const { rows } = await client.query<{ snapshot: Record<string, unknown> }>(
        `select snapshot from public.weekly_reviews where profile_id = $1`,
        [memberA.id],
      );
      expect(rows[0]?.snapshot['commitments_hit']).toBe(1);
      expect(rows[0]?.snapshot['doctrine_version']).toBe('2026.07-draft');
      expect(rows[0]?.snapshot).toHaveProperty('days_held');

      await client.query(`delete from public.weekly_reviews`);
      await client.query(`delete from public.commitments where profile_id = $1`, [memberA.id]);
    });

    it('is idempotent, and a retry does not move the snapshot', async () => {
      // §3.10: the outbox retries. A review already filed is the one that stands — a second
      // call must not re-snapshot against a week that has since gained rows.
      await settleAll();
      await asMemberCommitting(memberA, async (query) => {
        await query(`select public.file_weekly_review($1::date - 7, 'One', null, null)`, [monday]);
      });
      const first = await client.query<{ snapshot: unknown }>(
        `select snapshot from public.weekly_reviews where profile_id = $1`,
        [memberA.id],
      );

      const second = (await asMemberCommitting(memberA, (query) =>
        query(`select public.file_weekly_review($1::date - 7, 'Two', null, null)`, [monday]),
      )) as { file_weekly_review: { created: boolean } }[];
      expect(second[0]?.file_weekly_review.created).toBe(false);

      const after = await client.query<{ snapshot: unknown; n: string }>(
        `select snapshot, (select count(*)::text from public.weekly_reviews) as n
           from public.weekly_reviews where profile_id = $1`,
        [memberA.id],
      );
      expect(after.rows[0]?.n).toBe('1');
      expect(after.rows[0]?.snapshot).toEqual(first.rows[0]?.snapshot);

      await client.query(`delete from public.weekly_reviews`);
      await client.query(`delete from public.commitments where profile_id = $1`, [memberA.id]);
    });

    it('is immutable once written', async () => {
      await settleAll();
      await asMemberCommitting(memberA, async (query) => {
        await query(`select public.file_weekly_review($1::date - 7, 'One', null, null)`, [monday]);
      });
      await expect(
        client.query(`update public.weekly_reviews set what_worked = 'Something better'`),
      ).rejects.toThrow(/weekly_review_immutable/);

      await client.query(`delete from public.weekly_reviews`);
      await client.query(`delete from public.commitments where profile_id = $1`, [memberA.id]);
    });

    it('cannot be filed by anon', async () => {
      await asMember(null, async (query) => {
        await expect(
          query(`select public.file_weekly_review($1::date - 7, 'a', null, null)`, [monday]),
        ).rejects.toThrow(/permission denied|review_no_session/);
      });
    });

    it('has no insert policy, so the RPC is the only way in', async () => {
      // The grant and the policy set together are what make "the database computes the
      // snapshot" a fact rather than a convention.
      const { rows } = await client.query<{ cmd: string }>(
        `select cmd from pg_policies where tablename = 'weekly_reviews'`,
      );
      expect(rows.map((r) => r.cmd)).toEqual(['SELECT']);

      await asMember(memberA, async (query) => {
        await expect(
          query(
            `insert into public.weekly_reviews (profile_id, week_start, snapshot)
             values ($1, $2::date - 7, '{"days_held": 7}'::jsonb)`,
            [memberA.id, monday],
          ),
          'a member wrote his own snapshot',
        ).rejects.toThrow(/permission denied|row-level security/);
      });
    });
  });
  describe('mentor_directives', () => {
    async function write(author: Actor, subject: Actor, body: string): Promise<unknown[]> {
      return asMember(author, (query) =>
        query(
          `insert into public.mentor_directives (author_id, subject_id, week_start, body)
           values ($1, $2, $3::date, $4) returning id`,
          [author.id, subject.id, monday, body],
        ),
      );
    }

    it('lets the mentor write one to a man in his circle', async () => {
      const rows = await write(mentorA, memberA, 'Ten offers before Friday. No exceptions.');
      expect(rows).toHaveLength(1);
    });

    it('refuses a member writing one at all', async () => {
      // app.is_mentor() is the gate, and it is in the policy rather than in the UI — the
      // Command tab renders for everyone.
      await asMember(peerA, async (query) => {
        await expect(
          query(
            `insert into public.mentor_directives (author_id, subject_id, week_start, body)
             values ($1, $2, $3::date, 'Do as I say')`,
            [peerA.id, memberA.id, monday],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });

    it('refuses a mentor addressing another circle', async () => {
      // The clause app.is_mentor() alone would not supply. A mentor is a mentor of *his* circle.
      await asMember(mentorA, async (query) => {
        await expect(
          query(
            `insert into public.mentor_directives (author_id, subject_id, week_start, body)
             values ($1, $2, $3::date, 'Not yours to instruct')`,
            [mentorA.id, memberB.id, monday],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });

    it('refuses a directive addressed to himself', async () => {
      await expect(
        client.query(
          `insert into public.mentor_directives (author_id, subject_id, week_start, body)
           values ($1, $1, $2::date, 'Note to self')`,
          [mentorA.id, monday],
        ),
      ).rejects.toThrow(/directives_not_self/);
    });

    it('allows one per man per week and refuses a second', async () => {
      // The constraint that stops this becoming a feed. Saying something else means replacing
      // what he said, which is a different act from adding to it.
      await client.query(
        `insert into public.mentor_directives (author_id, subject_id, week_start, body)
         values ($1, $2, $3::date, 'First')`,
        [mentorA.id, memberA.id, monday],
      );
      await expect(
        client.query(
          `insert into public.mentor_directives (author_id, subject_id, week_start, body)
           values ($1, $2, $3::date, 'Second')`,
          [mentorA.id, memberA.id, monday],
        ),
      ).rejects.toThrow(/directives_one_per_subject_week/);
      await client.query(`delete from public.mentor_directives`);
    });

    it('shows it to the subject and to the author, and to nobody else', async () => {
      // The one place in this schema where the circle is deliberately shut out of something
      // about a member: a directive everyone can read is a public correction, and a public
      // correction is a thing a man defends himself against rather than acts on.
      await client.query(
        `insert into public.mentor_directives (author_id, subject_id, week_start, body)
         values ($1, $2, $3::date, 'Ten offers before Friday')`,
        [mentorA.id, memberA.id, monday],
      );

      const bySubject = await asMember(memberA, (query) =>
        query(`select body from public.mentor_directives`),
      );
      expect(bySubject, 'the subject could not read his own directive').toHaveLength(1);

      const byAuthor = await asMember(mentorA, (query) =>
        query(`select body from public.mentor_directives`),
      );
      expect(byAuthor).toHaveLength(1);

      const byPeer = await asMember(peerA, (query) =>
        query(`select * from public.mentor_directives`).catch(() => []),
      );
      expect(byPeer, 'a peer read a directive that was not his').toEqual([]);

      const byAnon = await asMember(null, (query) =>
        query(`select * from public.mentor_directives`).catch(() => []),
      );
      expect(byAnon).toEqual([]);

      await client.query(`delete from public.mentor_directives`);
    });

    it('cannot be edited in place, only replaced', async () => {
      // A directive amended after the man has read it means the two of them remember different
      // instructions, and only one of them can check. There is no UPDATE policy at all, so the
      // absence is the enforcement.
      await client.query(
        `insert into public.mentor_directives (author_id, subject_id, week_start, body)
         values ($1, $2, $3::date, 'Original')`,
        [mentorA.id, memberA.id, monday],
      );
      // Refused by the *grant*, not by a policy — UPDATE is simply not in the grant list, so
      // the privilege system rejects it before RLS is consulted. That is the stronger of the
      // two guarantees: a policy can be widened by accident, and a missing privilege has to be
      // granted on purpose.
      await asMember(mentorA, async (query) => {
        await expect(
          query(`update public.mentor_directives set body = 'Softened'`),
          'a directive was edited in place',
        ).rejects.toThrow(/permission denied/);
      });
      await client.query(`delete from public.mentor_directives`);
    });

    it('lets the author withdraw one and the subject not', async () => {
      await client.query(
        `insert into public.mentor_directives (author_id, subject_id, week_start, body)
         values ($1, $2, $3::date, 'Withdrawable')`,
        [mentorA.id, memberA.id, monday],
      );

      const bySubject = await asMember(memberA, (query) =>
        query(`delete from public.mentor_directives returning id`),
      );
      expect(bySubject, 'the subject deleted his own directive').toEqual([]);

      const byAuthor = await asMember(mentorA, (query) =>
        query(`delete from public.mentor_directives returning id`),
      );
      expect(byAuthor).toHaveLength(1);
      await client.query(`delete from public.mentor_directives`);
    });

    it('has no reply column, because a reply is the whole of a chat app', () => {
      // Asserted on the shape rather than left to restraint. §1 rules out chat, and the
      // difference between a directive and a message is exactly this absence.
      return client
        .query<{ attname: string }>(
          `select a.attname from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'mentor_directives'
              and a.attnum > 0 and not a.attisdropped
            order by a.attnum`,
        )
        .then(({ rows }) => {
          expect(rows.map((r) => r.attname)).toEqual([
            'id',
            'author_id',
            'subject_id',
            'week_start',
            'body',
            'created_at',
          ]);
        });
    });
  });
});
