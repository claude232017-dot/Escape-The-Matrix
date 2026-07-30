import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The Ledger, and the line drawn through it.
 *
 * The claim worth the most is the visibility split, for the same reason it was in the debrief:
 * **effort is circle-readable, amounts are not.** Offers made and deep work blocks are things
 * every man controls, so comparing them is accountability. Revenue is not, and a column of
 * amounts beside each other's names is a league table — which is the social feed §1 rules out,
 * wearing a different hat.
 *
 * A peer reading `money_entries` must get **zero rows**. The mentor must not, because ADR-009
 * disclosed that he sees everything.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('the Ledger', () => {
  let client: Client;
  let circleA: string;
  let mentorA: Actor;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let ventureA: string;
  let actions: Map<string, string>;
  /** Member A's own today. Resolved here because `authenticated` cannot reach the app schema. */
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

  /** £1,250.00 collected today. */
  async function bookRevenue(): Promise<void> {
    await client.query(
      `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency, category)
       values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', 125000, 'GBP', 'sale')`,
      [ventureA, memberA.id],
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

    await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);
    const { rows: actionRows } = await client.query<{ slug: string; id: string }>(
      `select slug, id from public.business_actions where circle_id = $1`,
      [circleA],
    );
    actions = new Map(actionRows.map((row) => [row.slug, row.id]));

    const ventures = await client.query<{ id: string }>(
      `insert into public.ventures (owner_id, name, kind, started_on)
       values ($1, 'Consultancy', 'B2B services', current_date - 10) returning id`,
      [memberA.id],
    );
    ventureA = ventures.rows[0]!.id;

    const { rows: today } = await client.query<{ d: string }>(
      `select app.today_for($1)::text as d`,
      [memberA.id],
    );
    todayA = today[0]!.d;
  }, 90_000);

  afterEach(async () => {
    await client.query(`delete from public.money_entries`);
    await client.query(`delete from public.daily_business_entries`);
  });

  afterAll(async () => {
    await client?.end();
  });

  describe('the seeded catalogue', () => {
    it('is ADR-003 exactly: six actions, no more', async () => {
      const { rows } = await client.query<{ slug: string }>(
        `select slug from public.business_actions where circle_id = $1 order by sort_order`,
        [circleA],
      );
      expect(rows.map((row) => row.slug)).toEqual([
        'offers-made',
        'conversations-held',
        'follow-ups-sent',
        'deep-work-blocks',
        'assets-shipped',
        'payments-collected',
      ]);
    });

    it('leaves the seventh slot open but refuses an eighth', async () => {
      // ADR-003's ceiling, enforced. Seven is where the daily entry stops being fillable
      // one-handed in under a minute, which is criterion 5 on the list that chose these six.
      await client.query(
        `insert into public.business_actions (circle_id, slug, label, sort_order)
         values ($1, 'seventh-slot', 'Something venture-specific', 70)`,
        [circleA],
      );
      await expect(
        client.query(
          `insert into public.business_actions (circle_id, slug, label, sort_order)
           values ($1, 'eighth-slot', 'One too many', 80)`,
          [circleA],
        ),
      ).rejects.toThrow(/business_actions_ceiling/);
      await client.query(`delete from public.business_actions where slug = 'seventh-slot'`);
    });

    it('counts only the live ones against the ceiling', async () => {
      // Retired rather than deleted, so a past day stays readable under the list that was live
      // when it was filed — and a retired action must not block a replacement.
      await client.query(
        `update public.business_actions set is_active = false where circle_id = $1 and slug = 'assets-shipped'`,
        [circleA],
      );
      await client.query(
        `insert into public.business_actions (circle_id, slug, label, sort_order)
         values ($1, 'seventh-slot', 'Replacement', 70), ($1, 'eighth-slot', 'And another', 80)`,
        [circleA],
      );
      await client.query(
        `delete from public.business_actions where slug in ('seventh-slot', 'eighth-slot')`,
      );
      await client.query(
        `update public.business_actions set is_active = true where circle_id = $1 and slug = 'assets-shipped'`,
        [circleA],
      );
    });

    it('is seeded idempotently', async () => {
      await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);
      await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.business_actions where circle_id = $1`,
        [circleA],
      );
      expect(rows[0]?.n).toBe('6');
    });
  });

  describe('the visibility split', () => {
    it('lets a peer read what he did', async () => {
      // Effort is what a circle is for. Everyone controls it, so comparing it is accountability.
      await client.query(
        `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
         values ($1, app.today_for($1), $2, $3, 4)`,
        [memberA.id, ventureA, actions.get('offers-made')],
      );
      const rows = await asMember(peerA, (query) =>
        query(`select count from public.daily_business_entries`),
      );
      expect(rows).toEqual([{ count: 4 }]);
    });

    it('gives a peer ZERO ROWS from the money', async () => {
      // The one that matters. A column of amounts beside each other's names is a league table,
      // and a league table is the social feed §1 rules out wearing a different hat.
      await bookRevenue();
      const rows = await asMember(peerA, (query) => query(`select * from public.money_entries`));
      expect(rows).toEqual([]);
    });

    it('lets the man himself read his own money', async () => {
      await bookRevenue();
      const rows = await asMember(memberA, (query) =>
        query(`select amount_minor::text as amount_minor, currency from public.money_entries`),
      );
      expect(rows).toEqual([{ amount_minor: '125000', currency: 'GBP' }]);
    });

    it('lets the mentor read it, as disclosed at enrollment', async () => {
      await bookRevenue();
      const rows = await asMember(mentorA, (query) =>
        query(`select amount_minor::text as amount_minor from public.money_entries`),
      );
      expect(rows).toEqual([{ amount_minor: '125000' }]);
    });

    it('gives another circle zero rows from everything', async () => {
      await bookRevenue();
      await client.query(
        `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
         values ($1, app.today_for($1), $2, $3, 4)`,
        [memberA.id, ventureA, actions.get('offers-made')],
      );
      const rows = await asMember(memberB, async (query) => ({
        ventures: await query(`select * from public.ventures`),
        entries: await query(`select * from public.daily_business_entries`),
        money: await query(`select * from public.money_entries`),
        catalogue: await query(`select * from public.business_actions`),
      }));
      expect(rows.ventures).toEqual([]);
      expect(rows.entries).toEqual([]);
      expect(rows.money).toEqual([]);
      expect(rows.catalogue).toEqual([]);
    });

    it('gives anon zero rows from everything', async () => {
      await bookRevenue();
      const rows = await asMember(null, async (query) => ({
        ventures: await query(`select * from public.ventures`).catch(() => []),
        money: await query(`select * from public.money_entries`).catch(() => []),
      }));
      expect(rows.ventures).toEqual([]);
      expect(rows.money).toEqual([]);
    });

    it('lets the circle see what a man is building', async () => {
      // The premise of the circle. Names and kinds, not amounts.
      const rows = await asMember(peerA, (query) =>
        query(`select name, kind from public.ventures`),
      );
      expect(rows).toEqual([{ name: 'Consultancy', kind: 'B2B services' }]);
    });

    it('accepts a write through a schema-qualified domain cast, as a browser sends it', async () => {
      // The bug this exists to stop coming back. Naming a venture failed in the browser with
      // `permission denied for schema app`, while every test here was green.
      //
      // PostgREST writes a schema-qualified cast for a domain column —
      // `insert into public.ventures (kind) values ($1::public.capped_text_140)` — and resolving
      // that type name at *parse* time needs USAGE on the schema. `authenticated` deliberately has
      // none on `app` (ADR-011), so while the domains lived there the statement was rejected
      // before RLS was ever consulted. Nothing caught it because every test wrote a bare SQL
      // literal, which needs no cast, and every earlier capped-column write went through a
      // SECURITY DEFINER RPC, where the cast is parsed as the owner.
      //
      // So this test writes the cast explicitly. Mirror: supabase/migrations/0007_domains_to_public.sql.
      const written = await asMember(memberA, async (query) => {
        const venture = (await query(
          `insert into public.ventures (owner_id, name, kind, started_on)
           values ($1, 'Cast probe', $2::public.capped_text_140, $3::date)
           returning id, kind`,
          [memberA.id, 'B2B services', todayA],
        )) as { id: string; kind: string }[];

        // money_entries carries both domains, and was the next tap that would have failed.
        const money = (await query(
          `insert into public.money_entries
             (id, venture_id, occurred_on, direction, category, amount_minor, currency, note)
           values (extensions.gen_random_uuid(), $1, $2::date, 'in', 'sale', 125000,
                   $3::public.currency_code, $4::public.capped_text_140)
           returning currency, note`,
          [venture[0]?.id, todayA, 'GBP', 'first sale'],
        )) as { currency: string; note: string }[];

        return { venture: venture[0], money: money[0] };
      });

      expect(written.venture?.kind).toBe('B2B services');
      expect(written.money).toEqual({ currency: 'GBP', note: 'first sale' });
    });

    it('has no domain left in a schema members cannot reach', async () => {
      // The general form of the above: any domain in `app` is a column type no browser can write.
      // Mirror: tests/db/rls-posture.test.ts asserts where the domains actually are.
      const stranded = await client.query<{ typname: string }>(
        `select t.typname from pg_type t
          where t.typtype = 'd' and t.typnamespace = 'app'::regnamespace`,
      );
      expect(
        stranded.rows.map((r) => r.typname),
        'domains in `app` are unwritable from PostgREST — move them to public',
      ).toEqual([]);
    });
  });

  describe('money is bigint minor units', () => {
    it('stores a large amount exactly', async () => {
      // §3.2. A float loses pennies silently and nobody notices until a year-end total is wrong
      // by an amount nobody can account for. Ten million pounds, to the penny.
      await client.query(
        `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency)
         values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', 1000000000, 'GBP')`,
        [ventureA, memberA.id],
      );
      const { rows } = await client.query<{ amount_minor: string }>(
        `select amount_minor::text as amount_minor from public.money_entries`,
      );
      expect(rows[0]?.amount_minor).toBe('1000000000');
    });

    it('refuses a zero or negative amount', async () => {
      // Amounts are always positive; `direction` says which way it went. A signed amount invites
      // a sign convention that half the queries get backwards.
      for (const amount of [0, -1]) {
        await expect(
          client.query(
            `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency)
             values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', $3, 'GBP')`,
            [ventureA, memberA.id, amount],
          ),
          `amount ${amount} was accepted`,
        ).rejects.toThrow(/money_entries_amount_positive/);
      }
    });

    it('refuses a currency that is not ISO-4217', async () => {
      // Mirror: CURRENCY_EXPONENTS in src/lib/money.ts.
      await expect(
        client.query(
          `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency)
           values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', 100, 'gbp')`,
          [ventureA, memberA.id],
        ),
      ).rejects.toThrow(/currency_code_format/);
    });
  });

  describe('anti-forgery', () => {
    it('refuses work recorded for a day he has not lived', async () => {
      await expect(
        client.query(
          `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
           values ($1, app.today_for($1) + 1, $2, $3, 4)`,
          [memberA.id, ventureA, actions.get('offers-made')],
        ),
      ).rejects.toThrow(/business_entry_in_future/);
    });

    it('refuses money recorded for a day he has not lived', async () => {
      await expect(
        asMember(memberA, (query) =>
          query(
            `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency)
             values (extensions.gen_random_uuid(), $1, ($2::date + 1), 'in', 100, 'GBP')`,
            [ventureA, todayA],
          ),
        ),
      ).rejects.toThrow(/money_in_future/);
    });

    it('refuses a count against another member’s venture', async () => {
      await expect(
        client.query(
          `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
           values ($1, app.today_for($1), $2, $3, 4)`,
          [peerA.id, ventureA, actions.get('offers-made')],
        ),
      ).rejects.toThrow(/business_entry_venture_not_yours/);
    });

    it('refuses an absurd count', async () => {
      await expect(
        client.query(
          `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
           values ($1, app.today_for($1), $2, $3, 5000)`,
          [memberA.id, ventureA, actions.get('offers-made')],
        ),
      ).rejects.toThrow(/daily_business_entries_count_sane/);
    });

    it('allows only one row per action per venture per day', async () => {
      // Also the outbox coalescing key: ten edits to one day produce one queued upsert.
      await client.query(
        `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
         values ($1, app.today_for($1), $2, $3, 4)`,
        [memberA.id, ventureA, actions.get('offers-made')],
      );
      await expect(
        client.query(
          `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
           values ($1, app.today_for($1), $2, $3, 9)`,
          [memberA.id, ventureA, actions.get('offers-made')],
        ),
      ).rejects.toThrow(/daily_business_entries_one_per_day/);
    });
  });

  describe('file_business_day', () => {
    it('is SECURITY INVOKER and not callable by anon', async () => {
      const { rows } = await client.query<{ prosecdef: boolean }>(
        `select prosecdef from pg_proc
          where pronamespace = 'public'::regnamespace and proname = 'file_business_day'`,
      );
      expect(rows[0]?.prosecdef, 'file_business_day must be SECURITY INVOKER').toBe(false);

      await expect(
        asMember(null, (query) =>
          query(`select public.file_business_day($1, current_date, '[]'::jsonb)`, [ventureA]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('records a day of counts', async () => {
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.file_business_day($1, $2::date, $3::jsonb)`, [
          ventureA,
          todayA,
          JSON.stringify([
            { action_id: actions.get('offers-made'), count: 4 },
            { action_id: actions.get('deep-work-blocks'), count: 3 },
          ]),
        ]);
        return query(
          `select a.slug, e.count from public.daily_business_entries e
             join public.business_actions a on a.id = e.action_id
            order by a.slug`,
        );
      });
      expect(rows).toEqual([
        { slug: 'deep-work-blocks', count: 3 },
        { slug: 'offers-made', count: 4 },
      ]);
    });

    it('is idempotent across three identical calls', async () => {
      // The outbox retries. A retry after an ambiguous failure must converge, not double the day's
      // offers — which on this table would be a lie about the one number ADR-003 calls most causal.
      const counts = await asMember(memberA, async (query) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await query(`select public.file_business_day($1, $2::date, $3::jsonb)`, [
            ventureA,
            todayA,
            JSON.stringify([{ action_id: actions.get('offers-made'), count: 4 }]),
          ]);
        }
        return query(
          `select count(*)::text as rows, max(count)::text as value from public.daily_business_entries`,
        );
      });
      expect(counts[0]).toEqual({ rows: '1', value: '4' });
    });

    it('does not wipe the actions he did not send', async () => {
      // Unlike protocol results, an absent action means "not recorded", not "changed to zero". A
      // man who corrects one number should not lose the other five.
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.file_business_day($1, $2::date, $3::jsonb)`, [
          ventureA,
          todayA,
          JSON.stringify([
            { action_id: actions.get('offers-made'), count: 4 },
            { action_id: actions.get('assets-shipped'), count: 1 },
          ]),
        ]);
        await query(`select public.file_business_day($1, $2::date, $3::jsonb)`, [
          ventureA,
          todayA,
          JSON.stringify([{ action_id: actions.get('offers-made'), count: 7 }]),
        ]);
        return query(
          `select a.slug, e.count from public.daily_business_entries e
             join public.business_actions a on a.id = e.action_id order by a.slug`,
        );
      });
      expect(rows).toEqual([
        { slug: 'assets-shipped', count: 1 },
        { slug: 'offers-made', count: 7 },
      ]);
    });

    it('refuses another member’s venture by name', async () => {
      await expect(
        asMember(peerA, (query) =>
          query(`select public.file_business_day($1, $2::date, '[]'::jsonb)`, [ventureA, todayA]),
        ),
      ).rejects.toThrow(/business_venture_not_yours/);
    });
  });

  describe('what the Ledger buys', () => {
    it('lines a Forge day up against a Ledger day', async () => {
      // The whole point (§0). Both sides are keyed on a date resolved in the same man's timezone,
      // so "deep work blocks on the days he held the Morning Protocol" is a join rather than a
      // research project. Phase 6 builds the analysis; this asserts the join is possible.
      const campaign = await client.query<{ id: string }>(
        `insert into public.campaigns (circle_id, name, starts_on) values ($1, 'C', current_date - 10)
         returning id`,
        [circleA],
      );
      const enrollment = await client.query<{ id: string }>(
        `insert into public.enrollments (profile_id, campaign_id, started_on)
         values ($1, $2, app.today_for($1) - 3) returning id`,
        [memberA.id, campaign.rows[0]!.id],
      );
      await client.query(
        `insert into public.sitreps (enrollment_id, local_date, final_status)
         values ($1, app.today_for($2), 'complete')`,
        [enrollment.rows[0]!.id, memberA.id],
      );
      await client.query(
        `insert into public.daily_business_entries (profile_id, local_date, venture_id, action_id, count)
         values ($1, app.today_for($1), $2, $3, 3)`,
        [memberA.id, ventureA, actions.get('deep-work-blocks')],
      );

      const { rows } = await client.query<{ final_status: string; blocks: number }>(
        `select s.final_status::text as final_status, e.count as blocks
           from public.sitreps s
           join public.enrollments en on en.id = s.enrollment_id
           join public.daily_business_entries e
             on e.profile_id = en.profile_id and e.local_date = s.local_date
          where en.profile_id = $1`,
        [memberA.id],
      );
      expect(rows).toEqual([{ final_status: 'complete', blocks: 3 }]);

      await client.query(`delete from public.sitreps`);
      await client.query(`delete from public.enrollments`);
      await client.query(`delete from public.campaigns`);
    });
  });
});
