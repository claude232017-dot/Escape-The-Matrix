import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The weekly loop. DOCTRINE §8.
 *
 * The claim worth the most here is **immutability**. Three-per-week is a cap and caps get
 * tested; the thing the feature actually rests on is that a commitment cannot be reworded
 * after the fact. If it can, nothing was committed to — and worse, the edit is invisible,
 * because the row reads as though he had meant that all along. So that rule is asserted
 * from every angle: the body, the week, the owner, and the day it was declared.
 *
 * Second: **the circle can read it.** That is not a design choice made in a migration, it is
 * what the enrollment disclosure told him would happen. A test that let it become private
 * would be letting the app quietly stop matching what he agreed to.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('commitments', () => {
  let client: Client;
  let circleA: string;
  let memberA: Actor;
  let peerA: Actor;
  let mentorA: Actor;
  let memberB: Actor;
  /** Member A's current Monday and today, resolved as the owner — `authenticated` cannot see. */
  let monday: string;
  let todayA: string;
  /** 1 = Monday … 7 = Sunday, for the one rule whose answer depends on where in the week we are. */
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

  /** Three declared this week, as he would declare them. */
  async function declareThree(): Promise<void> {
    await client.query(
      `insert into public.commitments (profile_id, week_start, body, declared_on)
       values ($1, $2::date, $3, $4::date), ($1, $2::date, $5, $4::date), ($1, $2::date, $6, $4::date)`,
      [memberA.id, monday, 'Ship the landing page', todayA, 'Ten sales calls', 'No alcohol'],
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
    const circleB = circles.rows[1]!.id;

    mentorA = await signUp('mentor-a@example.com', circleA, 'mentor');
    memberA = await signUp('member-a@example.com', circleA);
    peerA = await signUp('peer-a@example.com', circleA);
    memberB = await signUp('member-b@example.com', circleB);

    const dates = await client.query<{ monday: string; today: string; dow: string }>(
      `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday,
              to_char(app.today_for($1), 'YYYY-MM-DD') as today,
              extract(isodow from app.today_for($1))::text as dow`,
      [memberA.id],
    );
    monday = dates.rows[0]!.monday;
    todayA = dates.rows[0]!.today;
    isoDow = Number(dates.rows[0]!.dow);
  }, 90_000);

  afterEach(async () => {
    await client.query('delete from public.commitments');
  });

  afterAll(async () => {
    await client?.end();
  });

  describe('three, by constraint', () => {
    it('accepts three in a week', async () => {
      await declareThree();
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.commitments`,
      );
      expect(rows[0]?.n).toBe('3');
    });

    it('refuses a fourth', async () => {
      // §8: "Three is a cap enforced by a database constraint, not a suggestion."
      await declareThree();
      await expect(
        client.query(
          `insert into public.commitments (profile_id, week_start, body, declared_on)
           values ($1, $2::date, 'One more thing', $3::date)`,
          [memberA.id, monday, todayA],
        ),
      ).rejects.toThrow(/commitments_ceiling/);
    });

    it('counts per member-week, not globally', async () => {
      // The cap is a rule about his week. Another man's three, or his own three from another
      // week, must not consume his slots — a `count(*)` with a forgotten predicate would.
      await declareThree();
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date, 'A peer''s own commitment', $3::date)`,
        [peerA.id, monday, todayA],
      );
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.commitments`,
      );
      expect(rows[0]?.n).toBe('4');
    });

    it('refuses a fourth through the RPC too, before writing anything', async () => {
      // The count is checked *outside* the member's transaction on purpose. Inside it, the raise
      // has already aborted the transaction, so any follow-up query fails with "current
      // transaction is aborted" — which would look like the assertion passing for the wrong
      // reason. Asking afterwards, as the owner, is the only way to see what actually landed.
      await asMember(memberA, async (query) => {
        await expect(
          query(`select public.declare_commitments($1::date, $2::text[])`, [
            monday,
            ['One', 'Two', 'Three', 'Four'],
          ]),
        ).rejects.toThrow(/commitments_ceiling/);
      });

      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.commitments`,
      );
      expect(rows[0]?.n, 'a refused slate left rows behind').toBe('0');
    });
  });

  describe('declaring is committing', () => {
    it('refuses to reword a commitment', async () => {
      // The rule the whole feature rests on. A body that can be revised on Thursday in the
      // light of how the week is going has committed to nothing, and the revision leaves no
      // trace — the row simply reads as though he had meant that all along.
      await declareThree();
      await expect(
        client.query(`update public.commitments set body = 'Something easier'`),
      ).rejects.toThrow(/commitment_immutable/);
    });

    it('refuses to move one into a different week', async () => {
      await declareThree();
      await expect(
        client.query(`update public.commitments set week_start = week_start - 7`),
      ).rejects.toThrow(/commitment_immutable/);
    });

    it('refuses to hand one to another member', async () => {
      await declareThree();
      await expect(
        client.query(`update public.commitments set profile_id = $1`, [peerA.id]),
      ).rejects.toThrow(/commitment_immutable/);
    });

    it('refuses to restate the day it was declared', async () => {
      // Otherwise a Saturday scramble can be dressed up as Monday discipline.
      await declareThree();
      await expect(
        client.query(`update public.commitments set declared_on = week_start`),
      ).rejects.toThrow(/commitment_immutable/);
    });

    it('will not let a member post-date his own declaration', async () => {
      // The client-side half of the same rule, in the policy rather than the trigger.
      await asMember(memberA, async (query) => {
        await expect(
          query(
            `insert into public.commitments (profile_id, week_start, body, declared_on)
             values ($1, $2::date, 'Declared on Monday, honest', $2::date)`,
            [memberA.id, monday],
          ),
          'a member back-dated declared_on',
        ).rejects.toThrow(/row-level security|violates/);
      });
    });
  });

  describe('the week it belongs to', () => {
    it('refuses a week_start that is not a Monday', async () => {
      await expect(
        client.query(
          `insert into public.commitments (profile_id, week_start, body, declared_on)
           values ($1, $2::date + 2, 'Wednesday week', $3::date)`,
          [memberA.id, monday, todayA],
        ),
      ).rejects.toThrow(/commitments_week_start_is_monday/);
    });

    it('refuses a member declaring into a past week', async () => {
      // Rewriting a week that has already been read and judged.
      await asMember(memberA, async (query) => {
        await expect(
          query(`select public.declare_commitments($1::date - 7, $2::text[])`, [
            monday,
            ['Backdated'],
          ]),
        ).rejects.toThrow(/commitment_not_this_week/);
      });
    });

    it('refuses a member declaring into a future week', async () => {
      // Declaring early and editing later is the loophole immutability would otherwise leave.
      await asMember(memberA, async (query) => {
        await expect(
          query(`select public.declare_commitments($1::date + 7, $2::text[])`, [
            monday,
            ['Next week, provisionally'],
          ]),
        ).rejects.toThrow(/commitment_not_this_week/);
      });
    });

    it('refuses a blank commitment', async () => {
      await expect(
        client.query(
          `insert into public.commitments (profile_id, week_start, body, declared_on)
           values ($1, $2::date, '   ', $3::date)`,
          [memberA.id, monday, todayA],
        ),
      ).rejects.toThrow(/commitments_body_not_blank/);
    });

    it('caps the body at 140 characters, in the database', async () => {
      await expect(
        client.query(
          `insert into public.commitments (profile_id, week_start, body, declared_on)
           values ($1, $2::date, $3, $4::date)`,
          [memberA.id, monday, 'x'.repeat(141), todayA],
        ),
      ).rejects.toThrow(/capped_text_140/);
    });
  });

  describe('settle on Sunday', () => {
    it('opens settling exactly when the week is over', async () => {
      // The one rule whose answer depends on which day the suite runs, so it asserts the rule
      // rather than a fixed outcome: before Sunday settling is refused; on Sunday it is allowed.
      // Written this way rather than skipped, because a test that only runs one day in seven is
      // a rule nobody is actually checking.
      await declareThree();
      const settle = client.query(
        `update public.commitments set outcome = 'hit' where body = 'No alcohol'`,
      );

      if (isoDow < 7) {
        await expect(settle, `dow ${isoDow}: settling before Sunday was allowed`).rejects.toThrow(
          /commitment_too_early/,
        );
      } else {
        await expect(settle, 'dow 7: settling on Sunday was refused').resolves.toBeTruthy();
      }
    });

    it('settles a week that is over, and stamps when', async () => {
      // A past week always satisfies the rule, whatever day it is today — which is what makes
      // the happy path testable every day rather than one in seven.
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 14, 'Two weeks ago', $2::date - 14)`,
        [memberA.id, monday],
      );
      await client.query(`update public.commitments set outcome = 'missed'`);

      const { rows } = await client.query<{ outcome: string; resolved: boolean }>(
        `select outcome, resolved_at is not null as resolved from public.commitments`,
      );
      expect(rows[0]).toEqual({ outcome: 'missed', resolved: true });
    });

    it('will not un-answer a settled commitment', async () => {
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 14, 'Two weeks ago', $2::date - 14)`,
        [memberA.id, monday],
      );
      await client.query(`update public.commitments set outcome = 'hit'`);
      await expect(
        client.query(`update public.commitments set outcome = 'pending'`),
      ).rejects.toThrow(/commitment_already_settled/);
    });

    it('lets an honest correction through', async () => {
      // hit → missed is a man correcting himself, which the app should not stand in the way of.
      // Only the retreat to `pending` is closed.
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 14, 'Two weeks ago', $2::date - 14)`,
        [memberA.id, monday],
      );
      await client.query(`update public.commitments set outcome = 'hit'`);
      await expect(
        client.query(`update public.commitments set outcome = 'missed'`),
      ).resolves.toBeTruthy();
    });

    it('cannot be settled without saying when', async () => {
      await expect(
        client.query(
          `insert into public.commitments (profile_id, week_start, body, declared_on, outcome)
           values ($1, $2::date, 'Already won', $3::date, 'hit')`,
          [memberA.id, monday, todayA],
        ),
      ).rejects.toThrow(/commitments_resolved_together/);
    });
  });

  describe('who can read it', () => {
    it('lets the circle see what a man committed to, and how it went', async () => {
      // Exactly what the enrollment disclosure says: "your weekly commitments and whether you
      // hit them". If this ever returns zero rows, the app has stopped matching what he agreed
      // to — which is a disclosure problem, not a policy preference.
      await declareThree();
      const rows = await asMember(peerA, (query) =>
        query(`select body, outcome from public.commitments order by body`),
      );
      expect(rows).toHaveLength(3);
      expect((rows[0] as { body: string }).body).toBe('No alcohol');
    });

    it('lets the mentor read them, as disclosed', async () => {
      await declareThree();
      const rows = await asMember(mentorA, (query) =>
        query(`select body from public.commitments`),
      );
      expect(rows).toHaveLength(3);
    });

    it('gives another circle zero rows', async () => {
      await declareThree();
      const rows = await asMember(memberB, (query) =>
        query(`select * from public.commitments`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });

    it('gives anon zero rows', async () => {
      await declareThree();
      const rows = await asMember(null, (query) =>
        query(`select * from public.commitments`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });

    it('refuses a peer settling another man’s commitment', async () => {
      // Reading is disclosed. Answering for him is not.
      await client.query(
        `insert into public.commitments (profile_id, week_start, body, declared_on)
         values ($1, $2::date - 14, 'Two weeks ago', $2::date - 14)`,
        [memberA.id, monday],
      );
      const rows = await asMember(peerA, (query) =>
        query(`update public.commitments set outcome = 'hit' returning id`),
      );
      expect(rows, 'a peer settled a commitment that was not his').toEqual([]);
    });

    it('refuses a peer declaring on another man’s behalf', async () => {
      await asMember(peerA, async (query) => {
        await expect(
          query(
            `insert into public.commitments (profile_id, week_start, body, declared_on)
             values ($1, $2::date, 'Not his to make', $3::date)`,
            [memberA.id, monday, todayA],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });
  });

  describe('public.declare_commitments', () => {
    it('writes the slate in one call', async () => {
      const rows = await asMember(memberA, async (query) => {
        const result = (await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          ['Ship the landing page', 'Ten sales calls', 'No alcohol'],
        ])) as { declare_commitments: { written: number } }[];
        expect(result[0]?.declare_commitments.written).toBe(3);
        return query(`select body from public.commitments order by body`);
      });
      expect(rows).toHaveLength(3);
    });

    it('is idempotent across three identical calls', async () => {
      // §3.10: the outbox retries. Three calls, three rows — not nine.
      const rows = await asMember(memberA, async (query) => {
        for (let i = 0; i < 3; i += 1) {
          await query(`select public.declare_commitments($1::date, $2::text[])`, [
            monday,
            ['Ship the landing page', 'Ten sales calls'],
          ]);
        }
        return query(`select body from public.commitments order by body`);
      });
      expect(rows.map((r) => (r as { body: string }).body)).toEqual([
        'Ship the landing page',
        'Ten sales calls',
      ]);
    });

    it('lets him arrive at a different three while it is still the same day', async () => {
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          ['First thought', 'Second thought'],
        ]);
        await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          ['What he actually meant'],
        ]);
        return query(`select body from public.commitments`);
      });
      expect(rows.map((r) => (r as { body: string }).body)).toEqual(['What he actually meant']);
    });

    it('drops blank entries rather than storing them', async () => {
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          ['Real one', '   ', ''],
        ]);
        return query(`select body from public.commitments`);
      });
      expect(rows).toHaveLength(1);
    });

    it('trims what it stores', async () => {
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          ['  Ten sales calls  '],
        ]);
        return query(`select body from public.commitments`);
      });
      expect((rows[0] as { body: string }).body).toBe('Ten sales calls');
    });

    it('accepts an empty slate as a way of declaring nothing', async () => {
      const rows = await asMember(memberA, async (query) => {
        const result = (await query(`select public.declare_commitments($1::date, $2::text[])`, [
          monday,
          [],
        ])) as { declare_commitments: { written: number } }[];
        expect(result[0]?.declare_commitments.written).toBe(0);
        return query(`select * from public.commitments`);
      });
      expect(rows).toEqual([]);
    });

    it('is not callable by anon', async () => {
      await asMember(null, async (query) => {
        await expect(
          query(`select public.declare_commitments($1::date, $2::text[])`, [monday, ['x']]),
        ).rejects.toThrow(/permission denied|commitment_no_session/);
      });
    });

    it('cannot be aimed at another member', async () => {
      // It takes no profile argument at all — it reads auth.uid(). Asserted because the obvious
      // "helpful" future change is to add one.
      const { rows } = await client.query<{ args: string }>(
        `select pg_get_function_arguments(p.oid) as args
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'declare_commitments'`,
      );
      expect(rows[0]?.args).toBe('p_week_start date, p_bodies text[]');
    });
  });
});
