import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * Phase 8: the two promises SECURITY.md §2 has been carrying since Phase 0.
 *
 * **Export includes it.** *It* is the sexual-discipline compliance, the substance use and the
 * psychological profile — the material every other policy in this schema works to keep from his
 * peers. An export that quietly omitted the sensitive half would be the most defensible-looking
 * way to break the promise, so the assertions below name those tables specifically.
 *
 * **Deletion means deletion.** Proved by sweeping every table in `public` afterwards and
 * requiring zero rows mentioning him — enumerated from `pg_tables`, not from a list somebody
 * maintains, because the table that gets forgotten is always the one added last.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('export and deletion', () => {
  let client: Client;
  let circleA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;

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

  /** Without the rollback, for the deletion tests — the whole point is what survives. */
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

  /** A month of everything: the Forge, the Ledger, the week, and the sensitive half. */
  async function buildFullRecord(actor: Actor): Promise<void> {
    const campaign = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'August Campaign', current_date - 20, 30) returning id`,
      [circleA],
    );
    const campaignA = campaign.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);

    const enrollment = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 10) returning id`,
      [actor.id, campaignA],
    );
    const enrollmentA = enrollment.rows[0]!.id;

    const sitrep = await client.query<{ id: string }>(
      `insert into public.sitreps (enrollment_id, local_date, final_status)
       values ($1, app.today_for($2), 'complete') returning id`,
      [enrollmentA, actor.id],
    );
    const sitrepA = sitrep.rows[0]!.id;

    await client.query(
      `insert into public.protocol_results (sitrep_id, protocol_id, status)
       select $1, p.id, 'fail' from public.protocols p
        where p.campaign_id = $2 and p.visibility = 'aggregate_only' limit 1`,
      [sitrepA, campaignA],
    );
    await client.query(
      `insert into public.reset_events (enrollment_id, occurred_on, kind, reason, protocols_failed)
       values ($1, app.today_for($2) - 1, 'treason', 'Broke the oath', array['sexual-discipline'])`,
      [enrollmentA, actor.id],
    );
    await client.query(
      `insert into public.debriefs (sitrep_id, system_used, victory, attacked, outcome)
       values ($1, 'Clothes out the night before', 'Out before the negotiation', true, 'lost')`,
      [sitrepA],
    );
    await client.query(
      `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind, propaganda)
       values ($1, 15, 'low_energy', 'You have earned a break')`,
      [sitrepA],
    );

    const venture = await client.query<{ id: string }>(
      `insert into public.ventures (owner_id, name, kind, started_on)
       values ($1, 'Consultancy', 'B2B services', app.today_for($1) - 10) returning id`,
      [actor.id],
    );
    await client.query(
      `insert into public.money_entries
         (id, venture_id, occurred_on, direction, amount_minor, currency, category, note)
       values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', 125000, 'GBP', 'sale',
               'First retainer')`,
      [venture.rows[0]!.id, actor.id],
    );
    await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);
    await client.query(
      `insert into public.daily_business_entries (profile_id, venture_id, action_id, local_date, count)
       select $1, $2, a.id, app.today_for($1), 4 from public.business_actions a
        where a.circle_id = $3 order by a.sort_order limit 1`,
      [actor.id, venture.rows[0]!.id, circleA],
    );

    await client.query(
      `insert into public.commitments (profile_id, week_start, body, declared_on)
       values ($1, app.week_start_for($1), 'Ten sales calls', app.today_for($1))`,
      [actor.id],
    );
    await client.query(
      `insert into public.weekly_reviews (profile_id, week_start, what_worked, snapshot)
       values ($1, app.week_start_for($1) - 7, 'Shipped it', '{"days_held": 5}'::jsonb)`,
      [actor.id],
    );
    await client.query(
      `insert into public.mentor_directives (author_id, subject_id, week_start, body)
       values ($1, $2, app.week_start_for($2), 'Ten offers before Friday')`,
      [mentorA.id, actor.id],
    );

    const playbook = await client.query<{ id: string }>(
      `insert into public.playbooks (circle_id, promoted_by, title, body)
       values ($1, $2, 'Clothes out', 'Lay the kit out') returning id`,
      [circleA, mentorA.id],
    );
    await client.query(
      `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
       values ($1, $2, app.today_for($2))`,
      [playbook.rows[0]!.id, actor.id],
    );
  }

  beforeAll(async () => {
    await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    client = new Client({ connectionString: CONNECTION });
    await client.connect();

    const circles = await client.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle A') returning id`,
    );
    circleA = circles.rows[0]!.id;

    mentorA = await signUp('mentor-a@example.com', circleA, 'mentor');
    memberA = await signUp('member-a@example.com', circleA);
    peerA = await signUp('peer-a@example.com', circleA);


    await buildFullRecord(memberA);
  }, 90_000);

  afterAll(async () => {
    await client?.end();
  });

  describe('export includes it', () => {
    it('returns the sensitive half, not just the presentable half', async () => {
      // §3.5, and the assertion that matters most in this file. An export that skipped
      // bottom_g_tactics and the itemised protocol results would look complete and would be the
      // most defensible-looking way to break the promise.
      const rows = (await asMember(memberA, (query) =>
        query(`select public.export_my_data() as data`),
      )) as { data: Record<string, unknown[]> }[];
      const data = rows[0]!.data;

      expect(data['bottom_g_tactics'], 'the psychological profile was omitted').toHaveLength(1);
      expect(data['protocol_results'], 'itemised protocol detail was omitted').toHaveLength(1);
      expect(data['reset_events']).toHaveLength(1);
      expect(data['money_entries']).toHaveLength(1);
      expect(data['debriefs']).toHaveLength(1);
    });

    it('covers every part of his record', async () => {
      const rows = (await asMember(memberA, (query) =>
        query(`select public.export_my_data() as data`),
      )) as { data: Record<string, unknown> }[];
      const data = rows[0]!.data;

      for (const key of [
        'profile',
        'enrollments',
        'sitreps',
        'ventures',
        'daily_business_entries',
        'commitments',
        'weekly_reviews',
        'playbook_applications',
        'directives_received',
      ]) {
        expect(data[key], `the export has no ${key}`).toBeDefined();
      }
      expect((data['commitments'] as unknown[])).toHaveLength(1);
      expect((data['directives_received'] as unknown[])).toHaveLength(1);
    });

    it('carries the catalogue, so the ids mean something', async () => {
      // "You may have your data" is not honoured by handing somebody a file of join keys.
      const rows = (await asMember(memberA, (query) =>
        query(`select public.export_my_data() as data`),
      )) as { data: { catalogue: { protocols: unknown[]; business_actions: unknown[] } } }[];

      expect(rows[0]!.data.catalogue.protocols.length).toBeGreaterThan(0);
      expect(rows[0]!.data.catalogue.business_actions.length).toBeGreaterThan(0);
    });

    it('gives one man nothing of another’s', async () => {
      // The property that makes a SECURITY DEFINER function safe here.
      const rows = (await asMember(peerA, (query) =>
        query(`select public.export_my_data() as data`),
      )) as { data: Record<string, unknown[]> }[];

      expect(rows[0]!.data['sitreps']).toEqual([]);
      expect(rows[0]!.data['bottom_g_tactics']).toEqual([]);
      expect(rows[0]!.data['money_entries']).toEqual([]);
    });

    it('takes no argument through which to name somebody else', async () => {
      // Asserted on the signature, because the obvious future change is a profile parameter
      // "so the mentor can export on a member's behalf".
      const { rows } = await client.query<{ args: string }>(
        `select pg_get_function_arguments(p.oid) as args from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'export_my_data'`,
      );
      expect(rows[0]?.args).toBe('');
    });

    it('is not callable by anon', async () => {
      await asMember(null, async (query) => {
        await expect(query(`select public.export_my_data()`)).rejects.toThrow(
          /permission denied|export_no_session/,
        );
      });
    });
  });

  describe('deletion means deletion', () => {
    it('refuses without the confirming email', async () => {
      // The database's own are-you-sure. A UI confirmation is decoration (§3.3), and a call
      // that erases a man's month should not be one mis-tap away.
      // One session per attempt: a raise aborts the transaction, so a second assertion inside
      // the same block would fail with "current transaction is aborted" and look like a pass
      // for the wrong reason.
      for (const wrong of ['wrong@example.com', '', 'member-a@example.co']) {
        await asMember(memberA, async (query) => {
          await expect(
            query(`select public.delete_my_account($1)`, [wrong]),
            `"${wrong}" was accepted as confirmation`,
          ).rejects.toThrow(/delete_confirmation_mismatch/);
        });
      }

      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.profiles where id = $1`,
        [memberA.id],
      );
      expect(rows[0]?.n, 'a refused deletion still removed him').toBe('1');
    });

    it('accepts his own address whatever the case and spacing', async () => {
      // The guard exists to stop an accident, not to test his typing.
      const throwaway = await signUp('throwaway@example.com', circleA);
      await asMemberCommitting(throwaway, async (query) => {
        await expect(
          query(`select public.delete_my_account($1)`, ['  ThrowAway@Example.COM  ']),
        ).resolves.toBeTruthy();
      });
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from auth.users where id = $1`,
        [throwaway.id],
      );
      expect(rows[0]?.n).toBe('0');
    });

    it('takes no argument through which to erase somebody else', async () => {
      const { rows } = await client.query<{ args: string }>(
        `select pg_get_function_arguments(p.oid) as args from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_my_account'`,
      );
      expect(rows[0]?.args).toBe('p_confirm_email text');
    });

    it('leaves ZERO rows about him, in every table in public', async () => {
      // The promise, swept mechanically. Enumerated from pg_tables rather than from a list
      // somebody maintains, because the table that gets forgotten is always the one added last
      // — and a forgotten table here is a GDPR failure, not a bug.
      await asMemberCommitting(memberA, async (query) => {
        await query(`select public.delete_my_account($1)`, [memberA.email]);
      });

      const { rows: tables } = await client.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' order by tablename`,
      );

      const survivors: string[] = [];
      for (const { tablename } of tables) {
        // Every column that could name him: a uuid referencing profiles, whatever it is called.
        const { rows: columns } = await client.query<{ attname: string }>(
          `select a.attname
             from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
             join pg_type t on t.oid = a.atttypid
            where n.nspname = 'public' and c.relname = $1
              and a.attnum > 0 and not a.attisdropped and t.typname = 'uuid'`,
          [tablename],
        );
        for (const { attname } of columns) {
          const { rows: hits } = await client.query<{ n: string }>(
            `select count(*)::text as n from public.${tablename} where ${attname} = $1`,
            [memberA.id],
          );
          if (Number(hits[0]?.n ?? 0) > 0) survivors.push(`${tablename}.${attname}`);
        }
      }

      expect(
        survivors,
        `rows still naming a deleted member: ${survivors.join(', ')}`,
      ).toEqual([]);

      const { rows: auth } = await client.query<{ n: string }>(
        `select count(*)::text as n from auth.users where id = $1`,
        [memberA.id],
      );
      expect(auth[0]?.n, 'the auth account survived').toBe('0');
    });

    it('leaves a playbook he promoted standing, with no name on it', async () => {
      // The RESTRICT that made deletion impossible until 0012. The playbook stays because other
      // men adopted it and their applications are their own record; the promoter goes.
      const playbook = await client.query<{ id: string }>(
        `insert into public.playbooks (circle_id, promoted_by, title, body)
         values ($1, $2, 'Promoted by a man who left', 'Body') returning id`,
        [circleA, mentorA.id],
      );

      await asMemberCommitting(mentorA, async (query) => {
        await query(`select public.delete_my_account($1)`, [mentorA.email]);
      });

      const { rows } = await client.query<{ promoted_by: string | null }>(
        `select promoted_by from public.playbooks where id = $1`,
        [playbook.rows[0]!.id],
      );
      expect(rows, 'the playbook went with its promoter').toHaveLength(1);
      expect(rows[0]?.promoted_by).toBeNull();
    });

    it('keeps no tombstone', () => {
      // "Deletion means deletion." A `deleted_at` column would make that sentence false while
      // looking responsible, so the schema is asserted not to have grown one.
      return client
        .query<{ relname: string; attname: string }>(
          `select c.relname, a.attname
             from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and a.attnum > 0 and not a.attisdropped
              and (a.attname like '%deleted%' or a.attname like '%tombstone%'
                   or a.attname like '%anonymi%')`,
        )
        .then(({ rows }) => {
          expect(
            rows.map((r) => `${r.relname}.${r.attname}`),
            'a soft-delete column appeared; deletion no longer means deletion',
          ).toEqual([]);
        });
    });
  });
});
