import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * `public.file_sitrep` — filing a day.
 *
 * The function exists because a reset is four writes that must not half-apply, and the outbox
 * retries. So the two properties worth the most here are the ones a code review cannot establish:
 *
 *  1. **Idempotent.** Calling it twice with the same arguments leaves exactly the same rows —
 *     one SITREP, one set of results, one reset event, one successor enrollment. An outbox that
 *     retries a non-idempotent write is worse than no outbox.
 *  2. **Still behind RLS.** It is SECURITY INVOKER, so someone else's enrollment id is refused.
 *     A DEFINER version would be a hole in exactly the shape of these arguments, and the
 *     `prosecdef` assertion below is what stops that change passing review.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Actor {
  id: string;
  email: string;
}

describeDb('file_sitrep', () => {
  let client: Client;
  let circleA: string;
  let campaignA: string;
  let memberA: Actor;
  let peerA: Actor;
  let memberB: Actor;
  let protocols: Map<string, string>;
  let medOptions: Map<string, string>;
  /** Member A's own today, resolved from his timezone rather than the server's. */
  let todayA: string;

  /**
   * Run a block as one member, inside a transaction that is always rolled back.
   *
   * Multi-statement rather than the single-query helper used elsewhere, because the whole point
   * of these tests is to call the function and then look at what it left behind.
   */
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

  /** A fresh enrollment for member A, started `daysAgo` before his own today. */
  async function enrollA(daysAgo: number): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - $3::integer) returning id`,
      [memberA.id, campaignA, daysAgo],
    );
    return rows[0]!.id;
  }

  /** The three protocols live on day 1, all held. */
  function dayOneResults(status = 'pass'): string {
    return JSON.stringify(
      ['morning-protocol', 'daily-sitrep', 'sexual-discipline', 'video-games'].map((slug) => ({
        protocol_id: protocols.get(slug),
        status,
      })),
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

    memberA = {
      id: await signUp('member-a@example.com', circleA, 'member', 'America/New_York'),
      email: 'member-a@example.com',
    };
    peerA = { id: await signUp('peer-a@example.com', circleA), email: 'peer-a@example.com' };
    memberB = { id: await signUp('member-b@example.com', circleB), email: 'member-b@example.com' };

    const campaigns = await client.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'July Campaign', current_date - 20, 30) returning id`,
      [circleA],
    );
    campaignA = campaigns.rows[0]!.id;
    await client.query(`select app.seed_protocols_for_campaign($1)`, [campaignA]);

    const { rows: protocolRows } = await client.query<{ slug: string; id: string }>(
      `select slug, id from public.protocols where campaign_id = $1`,
      [campaignA],
    );
    protocols = new Map(protocolRows.map((r) => [r.slug, r.id]));

    const { rows: optionRows } = await client.query<{ label: string; id: string }>(
      `select o.label, o.id from public.protocol_med_options o
         join public.protocols p on p.id = o.protocol_id
        where p.campaign_id = $1 and p.slug = 'physical-forging'`,
      [campaignA],
    );
    medOptions = new Map(optionRows.map((r) => [r.label, r.id]));

    // Member A is in New York; the server may be in UTC. Between 00:00 and 05:00 UTC those are
    // different dates, and a test that used current_date would fail once a day.
    const { rows: today } = await client.query<{ d: string }>(
      `select app.today_for($1)::text as d`,
      [memberA.id],
    );
    todayA = today[0]!.d;
  }, 90_000);

  /**
   * Reset the enrollments between tests.
   *
   * In an afterEach rather than at the end of each test: a test that fails unexpectedly never
   * reaches its own cleanup, the stray active enrollment then collides with
   * enrollments_one_active_per_campaign, and every later test fails for a reason that has
   * nothing to do with what it was checking. One real failure became five.
   *
   * Successors first — previous_enrollment_id is ON DELETE RESTRICT, because history is not
   * something a cascade gets to remove.
   */
  afterEach(async () => {
    await client.query(`delete from public.enrollments where previous_enrollment_id is not null`);
    await client.query(`delete from public.enrollments`);
  });

  afterAll(async () => {
    await client?.end();
  });

  describe('posture', () => {
    it('is SECURITY INVOKER, so RLS still applies inside it', async () => {
      // The mutation this guards: flipping to DEFINER makes every ownership check below pass
      // for any caller, and nothing else in the codebase would look different.
      const { rows } = await client.query<{ proname: string; prosecdef: boolean }>(
        `select proname, prosecdef from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('file_sitrep', 'start_campaign_enrollment')
          order by proname`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.prosecdef, `${row.proname} must be SECURITY INVOKER`).toBe(false);
      }
    });

    it('pins search_path on both RPCs', async () => {
      const { rows } = await client.query<{ proname: string; proconfig: string[] | null }>(
        `select proname, proconfig from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname in ('file_sitrep', 'start_campaign_enrollment')`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(
          (row.proconfig ?? []).some((setting) => setting.startsWith('search_path=')),
          `${row.proname} must pin search_path, got ${JSON.stringify(row.proconfig)}`,
        ).toBe(true);
      }
    });

    it('is not callable by anon', async () => {
      // The anon key is public. An RPC reachable with it is reachable by anyone with the bundle.
      await expect(
        asMember(null, (query) =>
          query(`select public.file_sitrep($1::uuid, current_date, 'complete', '[]'::jsonb)`, [
            crypto.randomUUID(),
          ]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('is callable by authenticated', async () => {
      const enrollment = await enrollA(0);
      const rows = await asMember(memberA, (query) =>
        query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb) as result`, [
          enrollment,
          todayA,
          dayOneResults(),
        ]),
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('filing a day', () => {
    it('writes the SITREP and its results', async () => {
      const enrollment = await enrollA(0);
      const results = await asMember(memberA, async (query) => {
        await query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
          enrollment,
          todayA,
          dayOneResults(),
        ]);
        return query(
          `select p.slug, r.status::text as status
             from public.protocol_results r
             join public.protocols p on p.id = r.protocol_id
             join public.sitreps s on s.id = r.sitrep_id
            where s.enrollment_id = $1 order by p.slug`,
          [enrollment],
        );
      });
      expect(results).toEqual([
        { slug: 'daily-sitrep', status: 'pass' },
        { slug: 'morning-protocol', status: 'pass' },
        { slug: 'sexual-discipline', status: 'pass' },
        { slug: 'video-games', status: 'pass' },
      ]);
    });

    it('is idempotent: two identical calls leave one SITREP and one set of results', async () => {
      // This is the property the outbox depends on. A retry after an ambiguous failure — the
      // request landed but the response did not — must converge, not duplicate.
      const enrollment = await enrollA(0);
      const counts = await asMember(memberA, async (query) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]);
        }
        return query(
          `select (select count(*) from public.sitreps where enrollment_id = $1)::text as sitreps,
                  (select count(*) from public.protocol_results r
                     join public.sitreps s on s.id = r.sitrep_id
                    where s.enrollment_id = $1)::text as results`,
          [enrollment],
        );
      });
      expect(counts[0]).toEqual({ sitreps: '1', results: '4' });
    });

    it('returns the same sitrep id on a retry', async () => {
      const enrollment = await enrollA(0);
      const ids = await asMember(memberA, async (query) => {
        const collected: string[] = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const rows = (await query(
            `select public.file_sitrep($1, $2::date, 'complete', $3::jsonb) ->> 'sitrep_id' as id`,
            [enrollment, todayA, dayOneResults()],
          )) as { id: string }[];
          collected.push(rows[0]!.id);
        }
        return collected;
      });
      expect(ids[0]).toBe(ids[1]);
    });

    it('replaces the results on an amendment rather than merging them', async () => {
      // A stale result left behind would change what the day evaluates to, invisibly.
      const enrollment = await enrollA(0);
      const state = await asMember(memberA, async (query) => {
        await query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
          enrollment,
          todayA,
          dayOneResults(),
        ]);
        await query(
          `select public.file_sitrep($1, $2::date, 'repeat', $3::jsonb, null, $4::text[])`,
          [
            enrollment,
            todayA,
            JSON.stringify([
              { protocol_id: protocols.get('morning-protocol'), status: 'fail' },
              { protocol_id: protocols.get('daily-sitrep'), status: 'pass' },
              { protocol_id: protocols.get('sexual-discipline'), status: 'pass' },
              { protocol_id: protocols.get('video-games'), status: 'pass' },
            ]),
            ['morning-protocol'],
          ],
        );
        return query(
          `select s.final_status::text as final_status,
                  (select count(*) from public.protocol_results r where r.sitrep_id = s.id)::text as results,
                  (select count(*) from public.protocol_results r where r.sitrep_id = s.id and r.status = 'fail')::text as fails
             from public.sitreps s where s.enrollment_id = $1`,
          [enrollment],
        );
      });
      expect(state[0]).toEqual({ final_status: 'repeat', results: '4', fails: '1' });
    });

    it('records which MED alternative he took', async () => {
      const enrollment = await enrollA(5);
      const rows = await asMember(memberA, async (query) => {
        await query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
          enrollment,
          todayA,
          JSON.stringify([
            {
              protocol_id: protocols.get('physical-forging'),
              status: 'med_pass',
              med_option_id: medOptions.get('Option B'),
            },
          ]),
        ]);
        return query(
          `select o.label from public.protocol_results r
             join public.protocol_med_options o on o.id = r.med_option_id
             join public.sitreps s on s.id = r.sitrep_id
            where s.enrollment_id = $1`,
          [enrollment],
        );
      });
      expect(rows).toEqual([{ label: 'Option B' }]);
    });

    it('refuses a MED option on a full pass', async () => {
      // Mirror: setStatus() in src/features/forge/sitrep-draft.ts clears medOptionId when the
      // status leaves med_pass. This is the half that makes it true.
      const enrollment = await enrollA(5);
      await expect(
        asMember(memberA, (query) =>
          query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            JSON.stringify([
              {
                protocol_id: protocols.get('physical-forging'),
                status: 'pass',
                med_option_id: medOptions.get('Option A'),
              },
            ]),
          ]),
        ),
      ).rejects.toThrow(/protocol_results_med_option_only_for_med_pass/);
    });
  });

  describe('whose day it is', () => {
    it('refuses another member of the same circle', async () => {
      const enrollment = await enrollA(0);
      await expect(
        asMember(peerA, (query) =>
          query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]),
        ),
      ).rejects.toThrow(/sitrep_enrollment_not_yours/);
    });

    it('refuses a member of another circle', async () => {
      const enrollment = await enrollA(0);
      await expect(
        asMember(memberB, (query) =>
          query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]),
        ),
      ).rejects.toThrow(/sitrep_enrollment_not_yours/);
    });

    it('refuses an enrollment that has ended', async () => {
      const enrollment = await enrollA(0);
      await client.query(`update public.enrollments set status = 'withdrawn' where id = $1`, [
        enrollment,
      ]);
      await expect(
        asMember(memberA, (query) =>
          query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]),
        ),
      ).rejects.toThrow(/sitrep_enrollment_closed/);
    });

    it('refuses a day he has not lived yet', async () => {
      // Enforced by app.validate_sitrep, reached through this function. Without it a man files
      // thirty perfect days this afternoon and the dataset becomes fiction.
      const enrollment = await enrollA(0);
      await expect(
        asMember(memberA, (query) =>
          query(`select public.file_sitrep($1, ($2::date + 1), 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]),
        ),
      ).rejects.toThrow(/sitrep_in_future/);
    });
  });

  describe('a reset', () => {
    it('records the event, closes the enrollment and opens the next one', async () => {
      const enrollment = await enrollA(11);
      const state = await asMember(memberA, async (query) => {
        await query(
          `select public.file_sitrep($1, $2::date, 'reset', $3::jsonb, 'treason', $4::text[])`,
          [
            enrollment,
            todayA,
            JSON.stringify([
              { protocol_id: protocols.get('sexual-discipline'), status: 'fail' },
              { protocol_id: protocols.get('morning-protocol'), status: 'pass' },
            ]),
            ['sexual-discipline'],
          ],
        );
        return query(
          `select (select status::text from public.enrollments where id = $1) as old_status,
                  (select kind::text from public.reset_events where enrollment_id = $1) as kind,
                  (select array_to_string(protocols_failed, ',') from public.reset_events where enrollment_id = $1) as failed,
                  (select started_on::text from public.enrollments where previous_enrollment_id = $1) as next_start,
                  (select status::text from public.enrollments where previous_enrollment_id = $1) as next_status`,
          [enrollment],
        );
      });
      const next = new Date(`${todayA}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      expect(state[0]).toEqual({
        old_status: 'reset',
        kind: 'treason',
        failed: 'sexual-discipline',
        // The day after the breach: the breach belongs to the enrollment it happened in, and
        // one calendar date must not belong to two enrollments.
        next_start: next.toISOString().slice(0, 10),
        next_status: 'active',
      });
    });

    it('is idempotent: one reset event and one successor after three calls', async () => {
      const enrollment = await enrollA(11);
      const counts = await asMember(memberA, async (query) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await query(
            `select public.file_sitrep($1, $2::date, 'reset', $3::jsonb, 'zero_day', $4::text[])`,
            [
              enrollment,
              todayA,
              JSON.stringify([{ protocol_id: protocols.get('video-games'), status: 'fail' }]),
              ['video-games'],
            ],
          );
        }
        return query(
          `select (select count(*) from public.reset_events where enrollment_id = $1)::text as events,
                  (select count(*) from public.enrollments where previous_enrollment_id = $1)::text as successors`,
          [enrollment],
        );
      });
      expect(counts[0]).toEqual({ events: '1', successors: '1' });
    });

    it('cannot be taken back', async () => {
      // The successor enrollment already exists and may already have days filed against it.
      // Rewriting this day would orphan them, and history is never destroyed.
      const enrollment = await enrollA(11);
      await expect(
        asMember(memberA, async (query) => {
          await query(
            `select public.file_sitrep($1, $2::date, 'reset', $3::jsonb, 'treason', $4::text[])`,
            [
              enrollment,
              todayA,
              JSON.stringify([{ protocol_id: protocols.get('sexual-discipline'), status: 'fail' }]),
              ['sexual-discipline'],
            ],
          );
          return query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]);
        }),
      ).rejects.toThrow(/sitrep_reset_is_final/);
    });

    it('may only be filed for the latest reported day', async () => {
      // Otherwise the successor starts on a date that already has reports against this
      // enrollment, and every aggregate over "day 1" counts that date twice.
      const enrollment = await enrollA(11);
      await expect(
        asMember(memberA, async (query) => {
          await query(`select public.file_sitrep($1, $2::date, 'complete', $3::jsonb)`, [
            enrollment,
            todayA,
            dayOneResults(),
          ]);
          return query(
            `select public.file_sitrep($1, ($2::date - 1), 'reset', $3::jsonb, 'treason', $4::text[])`,
            [
              enrollment,
              todayA,
              JSON.stringify([{ protocol_id: protocols.get('sexual-discipline'), status: 'fail' }]),
              ['sexual-discipline'],
            ],
          );
        }),
      ).rejects.toThrow(/sitrep_reset_not_latest/);
    });

    it('cannot fork the enrollment chain', async () => {
      // Staged so that enrollments_one_successor is the *only* index that can fire: the parent is
      // closed and the first successor withdrawn, so enrollments_one_active_per_campaign is
      // satisfied. A naive two-row insert trips the active-enrollment index instead and proves
      // nothing about forking.
      const enrollment = await enrollA(11);
      await client.query(`update public.enrollments set status = 'reset' where id = $1`, [
        enrollment,
      ]);
      await client.query(
        `insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id, status)
         values ($1, $2, app.today_for($1), $3, 'withdrawn')`,
        [memberA.id, campaignA, enrollment],
      );
      await expect(
        client.query(
          `insert into public.enrollments (profile_id, campaign_id, started_on, previous_enrollment_id)
           values ($1, $2, app.today_for($1), $3)`,
          [memberA.id, campaignA, enrollment],
        ),
      ).rejects.toThrow(/enrollments_one_successor/);
    });
  });

  describe('start_campaign_enrollment', () => {
    it('creates one and then returns the same one', async () => {
      const ids = await asMember(peerA, async (query) => {
        const first = (await query(`select public.start_campaign_enrollment($1) as id`, [
          campaignA,
        ])) as { id: string }[];
        const second = (await query(`select public.start_campaign_enrollment($1) as id`, [
          campaignA,
        ])) as { id: string }[];
        return [first[0]!.id, second[0]!.id];
      });
      expect(ids[0]).toBe(ids[1]);
    });

    it('does not backdate a late joiner to the campaign start', async () => {
      // The campaign began 20 days ago. Starting there would credit him with 20 days he did not
      // run — and the enrollment trigger permits that date, so this function is the only guard.
      const rows = await asMember(peerA, async (query) => {
        await query(`select public.start_campaign_enrollment($1)`, [campaignA]);
        return query(
          `select started_on::text as started_on from public.enrollments
            where profile_id = $1 and campaign_id = $2`,
          [peerA.id, campaignA],
        );
      });
      const { rows: today } = await client.query<{ d: string }>(
        `select app.today_for($1)::text as d`,
        [peerA.id],
      );
      expect(rows).toEqual([{ started_on: today[0]!.d }]);
    });

    it('refuses a campaign in another circle', async () => {
      await expect(
        asMember(memberB, (query) =>
          query(`select public.start_campaign_enrollment($1)`, [campaignA]),
        ),
      ).rejects.toThrow(/campaign_not_found/);
    });

    it('is not callable by anon', async () => {
      await expect(
        asMember(null, (query) =>
          query(`select public.start_campaign_enrollment($1)`, [campaignA]),
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
