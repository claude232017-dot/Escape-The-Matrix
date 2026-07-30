import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The debrief, and the line drawn through the middle of it.
 *
 * The claim worth the most here is the visibility split. The Top G Insight is circle-readable —
 * a system that worked is the reason to be in a circle at all. The Bottom G Tactic is not: when a
 * man is weakest, what reliably beats him, and the exact lie he tells himself is a map of how to
 * break him, and DOCTRINE §7 gives peers his report status and whether he was hit, not that.
 *
 * A peer reading `bottom_g_tactics` must get **zero rows**. That is asserted directly here,
 * because the difference between "the policy looks right" and "the policy is right" is this file.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('the debrief', () => {
  let client: Client;
  let circleA: string;
  let campaignA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let enrollmentA: string;
  let sitrepA: string;

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

  /** A filed debrief with a 15:00 low-energy ambush he lost. */
  async function fileFullDebrief(): Promise<void> {
    await client.query(
      `insert into public.debriefs (sitrep_id, system_used, victory, attacked, outcome)
       values ($1, 'Laid gym clothes out the night before',
               'Out the door before the Bottom G could negotiate', true, 'lost')`,
      [sitrepA],
    );
    await client.query(
      `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind, propaganda)
       values ($1, 15, 'low_energy', 'You need a quick boost')`,
      [sitrepA],
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

    mentorA = { id: await signUp('mentor-a@example.com', circleA, 'mentor'), email: 'mentor-a@example.com' };
    memberA = { id: await signUp('member-a@example.com', circleA), email: 'member-a@example.com' };
    peerA = { id: await signUp('peer-a@example.com', circleA), email: 'peer-a@example.com' };
    memberB = { id: await signUp('member-b@example.com', circleB), email: 'member-b@example.com' };

    const campaigns = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'July Campaign', current_date - 20, 30) returning id`,
      [circleA],
    );
    campaignA = campaigns.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);

    const enrollments = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 5) returning id`,
      [memberA.id, campaignA],
    );
    enrollmentA = enrollments.rows[0]!.id;

    const sitreps = await client.query<{ id: string }>(
      `insert into public.sitreps (enrollment_id, local_date, final_status)
       values ($1, app.today_for($2), 'complete') returning id`,
      [enrollmentA, memberA.id],
    );
    sitrepA = sitreps.rows[0]!.id;
  }, 90_000);

  afterEach(async () => {
    await client.query(`delete from public.bottom_g_tactics`);
    await client.query(`delete from public.debriefs`);
  });

  afterAll(async () => {
    await client?.end();
  });

  describe('the visibility split', () => {
    it('lets a peer read the insight', async () => {
      // The reason a circle is worth being in. Phase 7's playbooks are built out of these.
      await fileFullDebrief();
      const rows = await asMember(peerA, (query) =>
        query(`select victory from public.debriefs where sitrep_id = $1`, [sitrepA]),
      );
      expect(rows).toEqual([
        { victory: 'Out the door before the Bottom G could negotiate' },
      ]);
    });

    it('lets a peer see that he was hit, per DOCTRINE §7', async () => {
      await fileFullDebrief();
      const rows = await asMember(peerA, (query) =>
        query(`select attacked, outcome::text as outcome from public.debriefs where sitrep_id = $1`, [
          sitrepA,
        ]),
      );
      expect(rows).toEqual([{ attacked: true, outcome: 'lost' }]);
    });

    it('gives a peer ZERO ROWS from the tactic', async () => {
      // The one that matters. When he is weakest, what beats him, and the lie he tells himself is
      // not a fact about his day — it is a map of how to break him.
      await fileFullDebrief();
      const rows = await asMember(peerA, (query) =>
        query(`select * from public.bottom_g_tactics`),
      );
      expect(rows).toEqual([]);
    });

    it('gives a member of another circle zero rows from either table', async () => {
      await fileFullDebrief();
      const rows = await asMember(memberB, async (query) => ({
        debriefs: await query(`select * from public.debriefs`),
        tactics: await query(`select * from public.bottom_g_tactics`),
      }));
      expect(rows.debriefs).toEqual([]);
      expect(rows.tactics).toEqual([]);
    });

    it('gives anon zero rows from either table', async () => {
      await fileFullDebrief();
      const rows = await asMember(null, async (query) => ({
        debriefs: await query(`select * from public.debriefs`).catch(() => []),
        tactics: await query(`select * from public.bottom_g_tactics`).catch(() => []),
      }));
      expect(rows.debriefs).toEqual([]);
      expect(rows.tactics).toEqual([]);
    });

    it('lets the man himself read his own tactic', async () => {
      await fileFullDebrief();
      const rows = await asMember(memberA, (query) =>
        query(
          `select occurred_at_hour, trigger_kind::text as trigger_kind, propaganda
             from public.bottom_g_tactics where sitrep_id = $1`,
          [sitrepA],
        ),
      );
      expect(rows).toEqual([
        { occurred_at_hour: 15, trigger_kind: 'low_energy', propaganda: 'You need a quick boost' },
      ]);
    });

    it('lets the mentor read it, as disclosed at enrollment', async () => {
      // ADR-009. The mentor sees everything, and the member was told so before he filed anything.
      await fileFullDebrief();
      const rows = await asMember(mentorA, (query) =>
        query(`select trigger_kind::text as trigger_kind from public.bottom_g_tactics`),
      );
      expect(rows).toEqual([{ trigger_kind: 'low_energy' }]);
    });

    it("does not let a peer write a debrief onto another man's day", async () => {
      await expect(
        asMember(peerA, (query) =>
          query(
            `insert into public.debriefs (sitrep_id, attacked, outcome) values ($1, true, 'lost')`,
            [sitrepA],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('the shape a debrief must have', () => {
    it('refuses a system with no victory', async () => {
      // Half a thought. The point of the pair is the causal link between them.
      await expect(
        client.query(
          `insert into public.debriefs (sitrep_id, system_used, attacked) values ($1, 'Laid clothes out', false)`,
          [sitrepA],
        ),
      ).rejects.toThrow(/debriefs_insight_paired/);
    });

    it('refuses a victory with no system', async () => {
      await expect(
        client.query(
          `insert into public.debriefs (sitrep_id, victory, attacked) values ($1, 'Got out the door', false)`,
          [sitrepA],
        ),
      ).rejects.toThrow(/debriefs_insight_paired/);
    });

    it('refuses an attack with no outcome', async () => {
      await expect(
        client.query(
          `insert into public.debriefs (sitrep_id, attacked) values ($1, true)`,
          [sitrepA],
        ),
      ).rejects.toThrow(/debriefs_outcome_iff_attacked/);
    });

    it('refuses an outcome with no attack', async () => {
      await expect(
        client.query(
          `insert into public.debriefs (sitrep_id, attacked, outcome) values ($1, false, 'lost')`,
          [sitrepA],
        ),
      ).rejects.toThrow(/debriefs_outcome_iff_attacked/);
    });

    it('refuses a tactic on a day he said he was not attacked', async () => {
      // Otherwise a peer reads "not attacked" while the mentor reads a 15:00 ambush, and both
      // believe they are looking at the same day.
      await client.query(
        `insert into public.debriefs (sitrep_id, attacked) values ($1, false)`,
        [sitrepA],
      );
      await expect(
        client.query(
          `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind)
           values ($1, 15, 'low_energy')`,
          [sitrepA],
        ),
      ).rejects.toThrow(/tactic_without_attack/);
    });

    it('refuses a tactic with no debrief at all', async () => {
      await expect(
        client.query(
          `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind)
           values ($1, 15, 'low_energy')`,
          [sitrepA],
        ),
      ).rejects.toThrow(/tactic_without_attack/);
    });

    it('refuses an hour outside the day', async () => {
      await client.query(
        `insert into public.debriefs (sitrep_id, attacked, outcome) values ($1, true, 'lost')`,
        [sitrepA],
      );
      for (const hour of [-1, 24, 99]) {
        await expect(
          client.query(
            `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind)
             values ($1, $2, 'low_energy')`,
            [sitrepA, hour],
          ),
          `hour ${hour} was accepted`,
        ).rejects.toThrow(/bottom_g_tactics_hour_range/);
      }
    });

    it('caps the propaganda at 140 characters', async () => {
      // Mirror: public.capped_text_140. It is meant to be the sentence the Bottom G used, not an
      // account of the day.
      await client.query(
        `insert into public.debriefs (sitrep_id, attacked, outcome) values ($1, true, 'lost')`,
        [sitrepA],
      );
      await expect(
        client.query(
          `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind, propaganda)
           values ($1, 15, 'low_energy', repeat('x', 141))`,
          [sitrepA],
        ),
      ).rejects.toThrow(/capped_text_140/);
    });

    it('allows exactly one debrief per day', async () => {
      await client.query(
        `insert into public.debriefs (sitrep_id, attacked) values ($1, false)`,
        [sitrepA],
      );
      await expect(
        client.query(
          `insert into public.debriefs (sitrep_id, attacked) values ($1, false)`,
          [sitrepA],
        ),
      ).rejects.toThrow(/debriefs_sitrep_id_key|duplicate key/);
    });
  });

  describe('file_debrief', () => {
    it('is SECURITY INVOKER and not callable by anon', async () => {
      const { rows } = await client.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc
          where pronamespace = 'public'::regnamespace and proname = 'file_debrief'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.prosecdef, 'file_debrief must be SECURITY INVOKER').toBe(false);

      await expect(
        asMember(null, (query) =>
          query(`select public.file_debrief($1, false)`, [sitrepA]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('writes both halves in one call', async () => {
      const state = await asMember(memberA, async (query) => {
        await query(
          `select public.file_debrief($1, true, 'Laid gym clothes out', 'Out before he could argue',
                                      null, 'resisted', 15::smallint, 'low_energy', 'You need a boost')`,
          [sitrepA],
        );
        return query(
          `select d.victory, d.outcome::text as outcome,
                  t.occurred_at_hour, t.trigger_kind::text as trigger_kind
             from public.debriefs d
             join public.bottom_g_tactics t on t.sitrep_id = d.sitrep_id
            where d.sitrep_id = $1`,
          [sitrepA],
        );
      });
      expect(state).toEqual([
        {
          victory: 'Out before he could argue',
          outcome: 'resisted',
          occurred_at_hour: 15,
          trigger_kind: 'low_energy',
        },
      ]);
    });

    it('is idempotent across three identical calls', async () => {
      // The outbox retries. A retry after an ambiguous failure must converge, not duplicate.
      const counts = await asMember(memberA, async (query) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await query(
            `select public.file_debrief($1, true, null, null, null, 'lost', 15::smallint, 'stress')`,
            [sitrepA],
          );
        }
        return query(
          `select (select count(*) from public.debriefs)::text as debriefs,
                  (select count(*) from public.bottom_g_tactics)::text as tactics`,
        );
      });
      expect(counts[0]).toEqual({ debriefs: '1', tactics: '1' });
    });

    it('removes the tactic when he amends the attack away', async () => {
      // Otherwise the two halves disagree and the cross-table trigger rejects the next write.
      const rows = await asMember(memberA, async (query) => {
        await query(
          `select public.file_debrief($1, true, null, null, null, 'lost', 15::smallint, 'stress')`,
          [sitrepA],
        );
        await query(`select public.file_debrief($1, false)`, [sitrepA]);
        return query(
          `select (select count(*) from public.bottom_g_tactics)::text as tactics,
                  (select attacked from public.debriefs where sitrep_id = $1) as attacked`,
          [sitrepA],
        );
      });
      expect(rows[0]).toEqual({ tactics: '0', attacked: false });
    });

    it("refuses another man's day by name", async () => {
      await expect(
        asMember(peerA, (query) => query(`select public.file_debrief($1, false)`, [sitrepA])),
      ).rejects.toThrow(/debrief_sitrep_not_yours/);
    });

    it('refuses a member of another circle', async () => {
      await expect(
        asMember(memberB, (query) => query(`select public.file_debrief($1, false)`, [sitrepA])),
      ).rejects.toThrow(/debrief_sitrep_not_yours/);
    });
  });

  describe('what the debrief buys', () => {
    it('answers "when does the enemy attack" as a GROUP BY', async () => {
      // DOCTRINE §6.3. This is the whole justification for the enum and for occurred_at_hour
      // being a number in his own timezone rather than an instant.
      const days = await client.query<{ id: string }>(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         select $1, app.today_for($2) - offset_days, 'repeat'
           from generate_series(1, 4) as offset_days
         returning id`,
        [enrollmentA, memberA.id],
      );
      for (const [index, row] of days.rows.entries()) {
        await client.query(
          `insert into public.debriefs (sitrep_id, attacked, outcome) values ($1, true, 'lost')`,
          [row.id],
        );
        await client.query(
          `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind)
           values ($1, $2, $3::public.bottom_g_trigger)`,
          [row.id, index < 3 ? 15 : 9, index < 3 ? 'low_energy' : 'stress'],
        );
      }

      const { rows } = await client.query<{ trigger_kind: string; n: string; hour: string }>(
        `select trigger_kind::text as trigger_kind, count(*)::text as n,
                round(avg(occurred_at_hour))::text as hour
           from public.bottom_g_tactics
          group by trigger_kind order by count(*) desc`,
      );
      expect(rows[0]).toEqual({ trigger_kind: 'low_energy', n: '3', hour: '15' });

      await client.query(`delete from public.bottom_g_tactics`);
      await client.query(`delete from public.debriefs`);
      await client.query(`delete from public.sitreps where id <> $1`, [sitrepA]);
    });
  });
});
