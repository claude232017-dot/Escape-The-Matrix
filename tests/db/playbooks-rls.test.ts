import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * Phase 7: a system offered to the circle, and whether it travels.
 *
 * The claim worth the most here is the **split between the count and the name**. A circle needs
 * to know that four men tried a system and three of them failed with it — that is the finding,
 * and it is the one thing a group can produce that an individual cannot. It does **not** need to
 * know which three, and the enrollment disclosure never told a member it would.
 *
 * So `playbook_applications` is self-and-mentor like money, and `public.playbook_transfer()` is
 * SECURITY DEFINER so it can count rows the caller cannot read. Both halves are asserted below:
 * a peer must get zero application rows and a correct total from the same session.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('playbooks', () => {
  let client: Client;
  let circleA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let mentorB: Actor;
  let playbookA: string;
  let insightA: string;
  let todayA: string;

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

  async function adopt(actor: Actor, outcome: string | null): Promise<void> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
       values ($1, $2, $3::date) returning id`,
      [playbookA, actor.id, todayA],
    );
    if (outcome) {
      await client.query(
        `update public.playbook_applications set outcome = $2::public.application_outcome
          where id = $1`,
        [rows[0]!.id, outcome],
      );
    }
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
    mentorB = await signUp('mentor-b@example.com', circleB, 'mentor');

    const dates = await client.query<{ today: string }>(
      `select to_char(app.today_for($1), 'YYYY-MM-DD') as today`,
      [memberA.id],
    );
    todayA = dates.rows[0]!.today;

    // A real Top G Insight to promote from: campaign → enrollment → sitrep → debrief. Built
    // because the one-per-source constraint is only meaningfully testable against a real
    // `promoted_from`, and a test that asserts a constraint exists in the catalogue rather than
    // that it fires is not a test of anything.
    const campaign = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'August Campaign', current_date - 10, 30) returning id`,
      [circleA],
    );
    const enrollment = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 5) returning id`,
      [memberA.id, campaign.rows[0]!.id],
    );
    const sitrep = await client.query<{ id: string }>(
      `insert into public.sitreps (enrollment_id, local_date, final_status)
       values ($1, app.today_for($2), 'complete') returning id`,
      [enrollment.rows[0]!.id, memberA.id],
    );
    const debrief = await client.query<{ id: string }>(
      `insert into public.debriefs (sitrep_id, system_used, victory, attacked)
       values ($1, 'Clothes out the night before',
               'Out the door before the Bottom G could negotiate', false)
       returning id`,
      [sitrep.rows[0]!.id],
    );
    insightA = debrief.rows[0]!.id;

    const playbook = await client.query<{ id: string }>(
      `insert into public.playbooks (circle_id, promoted_by, title, body)
       values ($1, $2, 'Clothes out the night before',
               'Lay the gym kit out before bed so the morning has no decision in it')
       returning id`,
      [circleA, mentorA.id],
    );
    playbookA = playbook.rows[0]!.id;
  }, 90_000);

  afterEach(async () => {
    await client.query('delete from public.playbook_applications');
  });

  afterAll(async () => {
    await client?.end();
  });

  describe('the catalogue', () => {
    it('lets the circle read it', async () => {
      const rows = await asMember(peerA, (query) =>
        query(`select title from public.playbooks`),
      );
      expect(rows).toEqual([{ title: 'Clothes out the night before' }]);
    });

    it('gives another circle nothing', async () => {
      const rows = await asMember(memberB, (query) =>
        query(`select * from public.playbooks`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });

    it('refuses a member promoting one', async () => {
      // Curated, not crowdsourced. Twelve men over thirty days produce hundreds of insights,
      // and self-promotion would make the catalogue a feed and promoting it a status move.
      await asMember(memberA, async (query) => {
        await expect(
          query(
            `insert into public.playbooks (circle_id, promoted_by, title, body)
             values ($1, $2, 'Mine', 'My system')`,
            [circleA, memberA.id],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });

    it('refuses a mentor promoting into another circle', async () => {
      // app.is_mentor() alone would allow this — the same gap directives had to close.
      await asMember(mentorB, async (query) => {
        await expect(
          query(
            `insert into public.playbooks (circle_id, promoted_by, title, body)
             values ($1, $2, 'Not his circle', 'Body')`,
            [circleA, mentorB.id],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });

    it('refuses two playbooks promoted from the same insight', async () => {
      // Duplicates split their own transfer evidence between them, which makes the one number
      // this whole feature produces meaningless.
      await client.query(
        `insert into public.playbooks (circle_id, promoted_by, promoted_from, title, body)
         values ($1, $2, $3, 'From the insight', 'Lay the kit out')`,
        [circleA, mentorA.id, insightA],
      );
      await expect(
        client.query(
          `insert into public.playbooks (circle_id, promoted_by, promoted_from, title, body)
           values ($1, $2, $3, 'Again', 'Lay the kit out')`,
          [circleA, mentorA.id, insightA],
        ),
      ).rejects.toThrow(/playbooks_one_per_source/);
      await client.query(`delete from public.playbooks where promoted_from = $1`, [insightA]);
    });

    it('keeps a playbook when the insight it came from is deleted', async () => {
      // ON DELETE SET NULL, not CASCADE. Men have adopted this system; losing the source
      // debrief must not take the playbook — and their applications — with it.
      const promoted = await client.query<{ id: string }>(
        `insert into public.playbooks (circle_id, promoted_by, promoted_from, title, body)
         values ($1, $2, $3, 'Survives', 'Lay the kit out') returning id`,
        [circleA, mentorA.id, insightA],
      );
      await client.query(`delete from public.debriefs where id = $1`, [insightA]);

      const { rows } = await client.query<{ promoted_from: string | null }>(
        `select promoted_from from public.playbooks where id = $1`,
        [promoted.rows[0]!.id],
      );
      expect(rows, 'the playbook went with its source').toHaveLength(1);
      expect(rows[0]?.promoted_from).toBeNull();
      await client.query(`delete from public.playbooks where id = $1`, [promoted.rows[0]!.id]);
    });

    it('lets the mentor retire one but never reword it', async () => {
      // Men are working from the words as written. Retiring is an is_active flip; the text is
      // immutable, enforced by a column-level grant rather than a policy, because WITH CHECK
      // cannot see OLD.
      await asMember(mentorA, async (query) => {
        await expect(
          query(`update public.playbooks set is_active = false returning id`),
        ).resolves.toHaveLength(1);
        await expect(
          query(`update public.playbooks set title = 'Reworded'`),
        ).rejects.toThrow(/permission denied/);
      });
    });

    it('refuses a member retiring one', async () => {
      const changed = await asMember(peerA, (query) =>
        query(`update public.playbooks set is_active = false returning id`),
      );
      expect(changed).toEqual([]);
    });
  });

  describe('applications are his own business', () => {
    it('lets a man adopt one and answer for it', async () => {
      await asMember(memberA, async (query) => {
        const rows = (await query(
          `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
           values ($1, $2, $3::date) returning id`,
          [playbookA, memberA.id, todayA],
        )) as { id: string }[];
        await query(
          `update public.playbook_applications set outcome = 'held' where id = $1`,
          [rows[0]!.id],
        );
        const after = (await query(
          `select outcome, resolved_at is not null as resolved from public.playbook_applications`,
        )) as { outcome: string; resolved: boolean }[];
        expect(after[0]).toEqual({ outcome: 'held', resolved: true });
      });
    });

    it('refuses a man adopting the same playbook twice', async () => {
      // Without this he could move a system's transfer rate on his own.
      await adopt(memberA, null);
      await expect(
        client.query(
          `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
           values ($1, $2, $3::date)`,
          [playbookA, memberA.id, todayA],
        ),
      ).rejects.toThrow(/applications_one_per_man/);
    });

    it('gives a peer ZERO application rows', async () => {
      // The line this feature is built around. A peer must not learn which systems failed for
      // another man — the enrollment disclosure never told him that would be shared.
      await adopt(memberA, 'did_not');
      const rows = await asMember(peerA, (query) =>
        query(`select * from public.playbook_applications`).catch(() => []),
      );
      expect(rows, 'a peer read which system failed for another man').toEqual([]);
    });

    it('lets the mentor read them, as ADR-009 disclosed', async () => {
      await adopt(memberA, 'did_not');
      const rows = await asMember(mentorA, (query) =>
        query(`select outcome from public.playbook_applications`),
      );
      expect(rows).toEqual([{ outcome: 'did_not' }]);
    });

    it('gives anon nothing', async () => {
      await adopt(memberA, 'held');
      const rows = await asMember(null, (query) =>
        query(`select * from public.playbook_applications`).catch(() => []),
      );
      expect(rows).toEqual([]);
    });

    it('refuses adopting on another man’s behalf', async () => {
      await asMember(peerA, async (query) => {
        await expect(
          query(
            `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
             values ($1, $2, $3::date)`,
            [playbookA, memberA.id, todayA],
          ),
        ).rejects.toThrow(/row-level security|violates/);
      });
    });

    it('will not un-answer an application', async () => {
      await adopt(memberA, 'held');
      await expect(
        client.query(`update public.playbook_applications set outcome = 'pending'`),
      ).rejects.toThrow(/application_already_answered/);
    });

    it('will not move an application to a different playbook', async () => {
      // Otherwise evidence moves from one system to another without a trace.
      await adopt(memberA, null);
      const other = await client.query<{ id: string }>(
        `insert into public.playbooks (circle_id, promoted_by, title, body)
         values ($1, $2, 'Another', 'Body') returning id`,
        [circleA, mentorA.id],
      );
      await expect(
        client.query(`update public.playbook_applications set playbook_id = $1`, [
          other.rows[0]!.id,
        ]),
      ).rejects.toThrow(/application_immutable/);
      await client.query(`delete from public.playbooks where id = $1`, [other.rows[0]!.id]);
    });

    it('lets him abandon an unanswered one but not a settled one', async () => {
      // Deleting an answered application is how a man removes the evidence that something did
      // not work for him.
      // Two men, because `asMember` rolls back: deleting memberA's row inside that block
      // leaves it in place afterwards, and adopting again would hit the one-per-man constraint
      // rather than testing anything.
      await adopt(memberA, null);
      const abandoned = await asMember(memberA, (query) =>
        query(`delete from public.playbook_applications returning id`),
      );
      expect(abandoned).toHaveLength(1);

      await adopt(peerA, 'did_not');
      const settled = await asMember(peerA, (query) =>
        query(`delete from public.playbook_applications returning id`),
      );
      expect(settled, 'a settled application was deleted').toEqual([]);
    });
  });

  describe('public.playbook_transfer', () => {
    it('counts what the caller cannot read', async () => {
      // The whole point of the function. A peer gets zero rows from the table and a correct
      // total from this, in the same session.
      await adopt(memberA, 'held');
      await adopt(peerA, 'did_not');

      const rows = (await asMember(peerA, (query) =>
        query(`select adopted, held, did_not, pending from public.playbook_transfer()`),
      )) as { adopted: number; held: number; did_not: number; pending: number }[];

      expect(rows[0]).toEqual({ adopted: 2, held: 1, did_not: 1, pending: 0 });
    });

    it('returns no name, and takes no argument to ask about one', async () => {
      // The two properties that keep it from being a hole. Asserted on the signature, because
      // the obvious "helpful" future change is to add a profile filter.
      const { rows } = await client.query<{ args: string; result: string }>(
        `select pg_get_function_arguments(p.oid) as args,
                pg_get_function_result(p.oid) as result
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'playbook_transfer'`,
      );
      expect(rows[0]?.args).toBe('');
      expect(rows[0]?.result).not.toContain('profile');
    });

    it('is scoped to the caller’s own circle', async () => {
      await adopt(memberA, 'held');
      const rows = await asMember(memberB, (query) =>
        query(`select * from public.playbook_transfer()`).catch(() => []),
      );
      expect(rows, 'another circle read this circle’s transfer counts').toEqual([]);
    });

    it('is not callable by anon', async () => {
      await asMember(null, async (query) => {
        await expect(query(`select * from public.playbook_transfer()`)).rejects.toThrow(
          /permission denied/,
        );
      });
    });

    it('reports a playbook nobody adopted as zero rather than omitting it', async () => {
      // A system nobody tried is a fact about the catalogue. Dropping it from the result would
      // make "untried" indistinguishable from "does not exist".
      const rows = (await asMember(memberA, (query) =>
        query(`select adopted from public.playbook_transfer()`),
      )) as { adopted: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.adopted).toBe(0);
    });
  });

  describe('what the schema refuses to have', () => {
    it('has no votes, likes or reactions anywhere', () => {
      // §1 rules out the social feed. Asserted on the catalogue rather than left to restraint,
      // because a vote column is one migration away and reads as harmless in a diff.
      return client
        .query<{ attname: string }>(
          `select a.attname from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relname in ('playbooks', 'playbook_applications')
              and a.attnum > 0 and not a.attisdropped`,
        )
        .then(({ rows }) => {
          const columns = rows.map((r) => r.attname).join(' ');
          for (const banned of ['vote', 'like', 'score', 'rank', 'star', 'rating', 'comment']) {
            expect(columns, `a column named for "${banned}" appeared`).not.toContain(banned);
          }
        });
    });
  });
});
