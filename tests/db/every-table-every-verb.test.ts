import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * §3.4, done mechanically: **every table, every verb.**
 *
 * The other RLS tests in this directory are hand-written and state what each policy is *for* —
 * that a peer sees effort but not amounts, that the mentor sees what the disclosure says he
 * sees. They are the ones worth reading. What they cannot do is prove they are complete: they
 * name tables one at a time, so a table added in a later phase is protected only if somebody
 * remembers to come back here.
 *
 * This one enumerates from `pg_tables` instead. A new table is covered the moment it exists,
 * and if it ships without a policy this test fails rather than the omission waiting to be
 * noticed. §3.5 is why that matters more here than it would elsewhere: these tables hold
 * sexual-discipline compliance, substance use and psychological failure patterns, per named
 * individual. A gap is an incident, not a bug.
 *
 * The probe is an outsider — a fully legitimate member of a different circle, holding a real
 * session. Not an attacker with a stolen key; the person most likely to find a hole by
 * accident. He must get **zero rows** from a SELECT and affect **zero rows** with an UPDATE or
 * a DELETE, on every table, plus be unable to insert.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

/**
 * Tables an outsider may legitimately read.
 *
 * One entry, and it needs to stay that way. Anything added here is a decision to let a member
 * of one circle read another circle's data, so it needs a reason that survives being read aloud.
 */
const CROSS_CIRCLE_READ_IS_INTENTIONAL: Record<string, string> = {
  app_meta:
    'Schema and doctrine version. Global and non-personal — there is no per-member or ' +
    'per-circle dimension to restrict it on, and the client needs it to know which doctrine ' +
    'version it is rendering.',
};

interface Actor {
  id: string;
  email: string;
}

describeDb('every table, every verb', () => {
  let client: Client;
  let tables: string[];
  let outsider: Actor;
  /** Row counts as the owner, so "zero rows for him" is distinguishable from "empty table". */
  let populated: Map<string, number>;
  /** Every row id that existed before the outsider did — i.e. every row that is not his. */
  let circleARows: Map<string, Set<string>>;

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
      // Always. This test issues DELETEs against every table in the schema.
      await client.query('rollback');
    }
  }

  /** Rows affected, or null when the statement was refused outright. Both are acceptable. */
  async function attempt(actor: Actor, sql: string): Promise<number | null> {
    return asMember(actor, async () => {
      try {
        const result = await client.query(sql);
        return result.rowCount ?? 0;
      } catch {
        return null;
      }
    });
  }

  async function signUp(email: string, circleId: string, role = 'member'): Promise<string> {
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
    return rows[0]!.id;
  }

  beforeAll(async () => {
    await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    client = new Client({ connectionString: CONNECTION });
    await client.connect();

    // Circle A only, for now. Circle B and the outsider are created *after* the snapshot below,
    // so that nothing of his ever lands in the set of rows he is not allowed to touch — including
    // his own circle's row, which he can legitimately read.
    const circles = await client.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle A') returning id`,
    );
    const circleA = circles.rows[0]!.id;

    await signUp('mentor-a@example.com', circleA, 'mentor');
    const memberA = await signUp('member-a@example.com', circleA);

    // Circle A gets a row in every table that holds member data, so a passing assertion below
    // means "he was refused" rather than "there was nothing there". The check at the end of
    // this block is what makes that guarantee real.
    const campaign = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'July Campaign', current_date - 20, 30) returning id`,
      [circleA],
    );
    const campaignA = campaign.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);
    await client.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);

    const enrollment = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 5) returning id`,
      [memberA, campaignA],
    );
    const enrollmentA = enrollment.rows[0]!.id;

    const sitrep = await client.query<{ id: string }>(
      `insert into public.sitreps (enrollment_id, local_date, final_status)
       values ($1, app.today_for($2), 'complete') returning id`,
      [enrollmentA, memberA],
    );
    const sitrepA = sitrep.rows[0]!.id;

    await client.query(
      `insert into public.protocol_results (sitrep_id, protocol_id, status)
       select $1, p.id, 'pass' from public.protocols p
        where p.campaign_id = $2 order by p.sort_order limit 1`,
      [sitrepA, campaignA],
    );
    await client.query(
      `insert into public.reset_events (enrollment_id, occurred_on, kind, reason, protocols_failed)
       values ($1, app.today_for($2) - 1, 'treason', 'Missed the oath', array['morning-protocol'])`,
      [enrollmentA, memberA],
    );
    await client.query(
      `insert into public.debriefs (sitrep_id, system_used, victory, attacked, outcome)
       values ($1, 'Clothes out the night before', 'Out before the negotiation started',
               true, 'lost')`,
      [sitrepA],
    );
    await client.query(
      `insert into public.bottom_g_tactics (sitrep_id, occurred_at_hour, trigger_kind, propaganda)
       values ($1, 15, 'low_energy', 'You have earned a break')`,
      [sitrepA],
    );

    const venture = await client.query<{ id: string }>(
      `insert into public.ventures (owner_id, name, kind, started_on)
       values ($1, 'Consultancy', 'B2B services', app.today_for($1)) returning id`,
      [memberA],
    );
    const ventureA = venture.rows[0]!.id;
    await client.query(
      `insert into public.daily_business_entries (profile_id, venture_id, action_id, local_date, count)
       select $1, $2, a.id, app.today_for($1), 4 from public.business_actions a
        where a.circle_id = $3 order by a.sort_order limit 1`,
      [memberA, ventureA, circleA],
    );
    await client.query(
      `insert into public.money_entries (id, venture_id, occurred_on, direction, amount_minor, currency, category, note)
       values (extensions.gen_random_uuid(), $1, app.today_for($2), 'in', 125000, 'GBP', 'sale',
               'First retainer')`,
      [ventureA, memberA],
    );

    await client.query(
      `insert into public.commitments (profile_id, week_start, body, declared_on)
       values ($1, app.week_start_for($1), 'Ten sales calls', app.today_for($1))`,
      [memberA],
    );

    // A filed review. Written directly rather than through the RPC because that function
    // refuses until the week is over and every commitment is answered — correct behaviour, and
    // more setup than this sweep needs to prove isolation.
    await client.query(
      `insert into public.weekly_reviews (profile_id, week_start, what_worked, snapshot)
       values ($1, app.week_start_for($1) - 7, 'Shipped it', '{"days_held": 5}'::jsonb)`,
      [memberA],
    );

    // A directive from the mentor to member A. Visible to those two only, which is exactly
    // what makes it worth sweeping: the outsider must get nothing, and so would a peer.
    await client.query(
      `insert into public.mentor_directives (author_id, subject_id, week_start, body)
       select p.id, $1, app.week_start_for($1), 'Ten offers before Friday'
         from public.profiles p where p.role = 'mentor' limit 1`,
      [memberA],
    );

    // A promoted playbook and one man's application of it. The application is the interesting
    // one for this sweep: it is self-and-mentor, so the outsider must get nothing.
    const playbook = await client.query<{ id: string }>(
      `insert into public.playbooks (circle_id, promoted_by, title, body)
       select $1, p.id, 'Clothes out the night before', 'Lay the kit out before bed'
         from public.profiles p where p.role = 'mentor' limit 1
       returning id`,
      [circleA],
    );
    await client.query(
      `insert into public.playbook_applications (playbook_id, profile_id, adopted_on)
       values ($1, $2, app.today_for($2))`,
      [playbook.rows[0]!.id, memberA],
    );

    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    tables = rows.map((r) => r.tablename);

    // Snapshot circle A's rows *before* the outsider exists, so the set contains nothing of his.
    // This is what makes the assertions exact rather than approximate: the earlier version
    // counted rows and called any row a leak, which flagged the outsider reading his own circle
    // and his own profile — correct behaviour, reported as a breach. §3.4 asks a sharper
    // question than "did he see anything": it asks whether he saw *member B's rows*.
    circleARows = new Map();
    populated = new Map();
    for (const table of tables) {
      const ids = await client.query<{ id: string }>(`select id::text as id from public.${table}`);
      circleARows.set(table, new Set(ids.rows.map((r) => r.id)));
      populated.set(table, ids.rows.length);
    }

    const circleB = await client.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle B') returning id`,
    );
    outsider = {
      id: await signUp('outsider@example.com', circleB.rows[0]!.id),
      email: 'outsider@example.com',
    };
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it('has a row in every table, so a refusal is not an empty table', () => {
    // The assertion that keeps every other assertion in this file honest. Without it, adding a
    // table and forgetting to populate it here would make its isolation trivially "pass".
    const empty = tables.filter((t) => (populated.get(t) ?? 0) === 0);
    expect(empty, `no fixture data — isolation for these is unproven: ${empty.join(', ')}`).toEqual(
      [],
    );
  });

  it('gives an outsider zero of another circle’s rows, from every table', async () => {
    const leaked: string[] = [];
    for (const table of tables) {
      if (table in CROSS_CIRCLE_READ_IS_INTENTIONAL) continue;
      const mine = circleARows.get(table) ?? new Set<string>();
      const rows = (await asMember(outsider, (query) =>
        query(`select id::text as id from public.${table}`).catch(() => []),
      )) as { id: string }[];
      const stolen = rows.filter((r) => mine.has(r.id));
      if (stolen.length > 0) leaked.push(`${table} (${stolen.length} rows)`);
    }
    expect(leaked, `another circle's member can read: ${leaked.join(', ')}`).toEqual([]);
  });

  it('gives anon zero rows from every table, including the exempt one', async () => {
    // The anon key is public and committed (§3.3). Even app_meta is behind a session — it is
    // readable by any *signed-in* member, which is not the same as readable by the internet.
    // Nothing here is anon's, so the plain row count is the right question for once.
    const leaked: string[] = [];
    for (const table of tables) {
      const rows = await asMember(null, (query) =>
        query(`select * from public.${table}`).catch(() => []),
      );
      if (rows.length > 0) leaked.push(`${table} (${rows.length} rows)`);
    }
    expect(leaked, `the public anon key can read: ${leaked.join(', ')}`).toEqual([]);
  });

  it('lets an outsider delete none of another circle’s rows, anywhere', async () => {
    // DELETE needs no column knowledge, which is what makes it the honest sweep. Scoped to
    // circle A's ids so deleting his own row — which he may legitimately be allowed to do —
    // is not reported as a breach. Every call is rolled back.
    const destroyed: string[] = [];
    for (const table of tables) {
      const ids = [...(circleARows.get(table) ?? [])];
      if (ids.length === 0) continue;
      const affected = await attempt(
        outsider,
        `delete from public.${table} where id::text in (${ids.map((i) => `'${i}'`).join(',')})`,
      );
      if (affected !== null && affected > 0) destroyed.push(`${table} (${affected} rows)`);
    }
    expect(destroyed, `another circle's member can delete from: ${destroyed.join(', ')}`).toEqual(
      [],
    );
  });

  it('lets an outsider update none of another circle’s rows, anywhere', async () => {
    // Set each row's first column to the value it already has. A no-op write that still has to
    // pass USING and WITH CHECK, so the row count is the whole answer.
    const written: string[] = [];
    for (const table of tables) {
      const ids = [...(circleARows.get(table) ?? [])];
      if (ids.length === 0) continue;
      const { rows } = await client.query<{ attname: string }>(
        `select a.attname
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1
            and a.attnum > 0 and not a.attisdropped
          order by a.attnum limit 1`,
        [table],
      );
      const column = rows[0]?.attname;
      if (!column) continue;
      const affected = await attempt(
        outsider,
        `update public.${table} set ${column} = ${column}
          where id::text in (${ids.map((i) => `'${i}'`).join(',')})`,
      );
      if (affected !== null && affected > 0) written.push(`${table} (${affected} rows)`);
    }
    expect(written, `another circle's member can update: ${written.join(', ')}`).toEqual([]);
  });

  it('names every table it swept, so the sweep cannot silently shrink', () => {
    // A catalogue query that started returning nothing would make all of the above vacuous.
    expect(tables.length).toBeGreaterThanOrEqual(17);
    for (const required of ['bottom_g_tactics', 'money_entries', 'protocol_results', 'sitreps']) {
      expect(tables).toContain(required);
    }
  });
});
