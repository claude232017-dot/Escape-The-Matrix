import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadForge } from '@/features/forge/use-forge-data';
import { sendSitrep } from '@/features/forge/sitrep-write';
import { sendDebrief } from '@/features/forge/debrief-write';
import { sendBusinessDay, sendMoneyEntry, sendVenture } from '@/features/ledger/ledger-write';
import { resetSupabaseClient } from '@/lib/supabase';
import { startHarness, type Actor, type Harness } from './harness.ts';

/**
 * The application's own queries, against a real PostgREST.
 *
 * ---------------------------------------------------------------------------
 * The gap this closes
 * ---------------------------------------------------------------------------
 * Two suites covered this app and neither covered the seam between them. `tests/db` issues
 * SQL through `pg` — SQL no browser ever sends. `tests/browser` drives a harness with
 * fixture data and no session — it makes no request at all. PostgREST sat between them,
 * untested, and it is what every real read and write actually goes through.
 *
 * Two bugs lived there, both shipped green:
 *
 *   - naming a venture failed with `permission denied for schema app`, because PostgREST
 *     emits a schema-qualified cast for a domain column and `tests/db` writes bare literals;
 *   - every page load logged a 400, because an embed named two tables with no foreign key
 *     between them, which only PostgREST knows or cares about.
 *
 * ---------------------------------------------------------------------------
 * Why it imports from `src/` rather than restating the queries
 * ---------------------------------------------------------------------------
 * This is the load-bearing decision in the file. A test that re-types
 * `.from('debriefs').select(...)` proves that the re-typing works. The queries that broke
 * were the ones in `src/`, so those are the ones called here — `loadForge`, `sendVenture`,
 * `sendSitrep`, `sendDebrief`, `sendBusinessDay`, `sendMoneyEntry`, through the real
 * `getSupabase()` client with nothing stubbed.
 *
 * ---------------------------------------------------------------------------
 * What it does not cover
 * ---------------------------------------------------------------------------
 * GoTrue. Signup, the two auth triggers, password recovery and §3.7's ordering are covered
 * by the browser suite and by the bootstrap being run by hand. Recorded as an open gap in
 * docs/SECURITY.md §5 rather than quietly implied to be covered.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeE2E = CONNECTION ? describe : describe.skip;

describeE2E('the app against a real PostgREST', () => {
  let h: Harness;
  let circleA: string;
  let memberA: Actor;
  let peerA: Actor;
  let mentorA: Actor;
  let outsider: Actor;
  let today: string;
  let campaignId: string;

  beforeAll(async () => {
    h = await startHarness();
    // The client memoises; a previous suite in the same process must not leak its config.
    resetSupabaseClient();

    const circles = await h.db.query<{ id: string }>(
      `insert into public.circles (name) values ('Circle A'), ('Circle B') returning id`,
    );
    circleA = circles.rows[0]!.id;
    const circleB = circles.rows[1]!.id;

    mentorA = await h.signUp('mentor-a@example.com', circleA, 'mentor');
    memberA = await h.signUp('member-a@example.com', circleA);
    peerA = await h.signUp('peer-a@example.com', circleA);
    outsider = await h.signUp('outsider@example.com', circleB);

    const campaigns = await h.db.query<{ id: string }>(
      `insert into public.campaigns (circle_id, name, starts_on, length_days)
       values ($1, 'August Campaign', current_date - 3, 30) returning id`,
      [circleA],
    );
    campaignId = campaigns.rows[0]!.id;
    await h.db.query(`select app.seed_protocols_for_campaign($1)`, [campaignId]);
    await h.db.query(`select app.seed_business_actions_for_circle($1)`, [circleA]);

    // Resolved once as the owner: `authenticated` cannot reach the app schema (ADR-011).
    const dates = await h.db.query<{ d: string }>(
      `select to_char(app.today_for($1), 'YYYY-MM-DD') as d`,
      [memberA.id],
    );
    today = dates.rows[0]!.d;

    await h.db.query(
      `insert into public.enrollments (profile_id, campaign_id, started_on)
       values ($1, $2, app.today_for($1) - 2)`,
      [memberA.id, campaignId],
    );
  });

  afterAll(async () => {
    await h?.stop();
  });

  describe('the Forge loads', () => {
    it('reads a whole day without a single failed request', async () => {
      // The regression that logged a 400 on every load. `loadForge` had a fallback under the
      // broken embed, so the screen worked and only the console knew. Here the failure is
      // visible: a rejected request surfaces as a throw or as missing data.
      h.become(memberA);
      const loaded = await loadForge(memberA.id, today);

      expect(loaded).not.toBeNull();
      expect(loaded?.campaign.name).toBe('August Campaign');
      expect(loaded?.protocols.length).toBeGreaterThan(0);
      expect(loaded?.enrollment).not.toBeNull();
    });

    it('resolves every embed it asks for', async () => {
      // `protocols → protocol_med_options` and the two `sitreps → enrollments` chains. An
      // embed PostgREST cannot resolve is a 400, and a 400 here means empty data rather than
      // an exception — so this asserts the shape actually arrived.
      h.become(memberA);
      const loaded = await loadForge(memberA.id, today);
      const withMed = loaded?.protocols.filter((p) => (p.medOptions?.length ?? 0) > 0) ?? [];
      expect(withMed.length, 'no MED options came back — the embed resolved to nothing').
        toBeGreaterThan(0);
    });

    it('gives another circle’s member nothing', async () => {
      h.become(outsider);
      expect(await loadForge(outsider.id, today)).toBeNull();
    });
  });

  describe('the Ledger writes', () => {
    let ventureId: string;

    it('names a venture — the write that failed in a member’s hands', async () => {
      // `kind` is `capped_text_140`. PostgREST emits `$1::public.capped_text_140` for it, and
      // while that domain lived in `app` the statement was rejected before RLS was consulted.
      // This is the only test in the repo that sends that request the way a browser does.
      h.become(memberA);
      await expect(
        sendVenture({
          ownerId: memberA.id,
          name: 'Consultancy',
          kind: 'B2B services',
          startedOn: today,
        }),
      ).resolves.toBeUndefined();

      const { rows } = await h.db.query<{ id: string; kind: string }>(
        `select id, kind from public.ventures where owner_id = $1`,
        [memberA.id],
      );
      expect(rows[0]?.kind).toBe('B2B services');
      ventureId = rows[0]!.id;
    });

    it('books money — both domains on one row', async () => {
      // `currency` and `note` are the other two domain columns, and this is the tap that
      // would have failed next.
      h.become(memberA);
      const id = crypto.randomUUID();
      await expect(
        sendMoneyEntry({
          id,
          ventureId,
          occurredOn: today,
          direction: 'in',
          amountMinor: '125000',
          currency: 'GBP',
          category: 'sale',
          isRecurring: false,
          note: 'First retainer',
        }),
      ).resolves.toBeUndefined();

      const { rows } = await h.db.query<{ amount_minor: string; note: string }>(
        `select amount_minor::text as amount_minor, note from public.money_entries where id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ amount_minor: '125000', note: 'First retainer' });
    });

    it('is idempotent on a retry, so an ambiguous failure cannot book twice', async () => {
      // §3.10: the outbox retries. The client-generated id is what makes that safe, and this
      // proves it through the real upsert rather than through the SQL underneath it.
      h.become(memberA);
      const id = crypto.randomUUID();
      const payload = {
        id,
        ventureId,
        occurredOn: today,
        direction: 'in' as const,
        amountMinor: '5000',
        currency: 'GBP' as const,
        category: 'sale' as const,
        isRecurring: false,
        note: null,
      };
      await sendMoneyEntry(payload);
      await sendMoneyEntry(payload);

      const { rows } = await h.db.query<{ n: string }>(
        `select count(*)::text as n from public.money_entries where id = $1`,
        [id],
      );
      expect(rows[0]?.n).toBe('1');
    });

    it('records a day of counts through the RPC', async () => {
      h.become(memberA);
      const actions = await h.db.query<{ id: string }>(
        `select id from public.business_actions where circle_id = $1 order by sort_order limit 2`,
        [circleA],
      );
      const result = await sendBusinessDay({
        ventureId,
        localDate: today,
        counts: [
          { actionId: actions.rows[0]!.id, count: 4 },
          { actionId: actions.rows[1]!.id, count: 2 },
        ],
      });
      expect(result.written).toBe(2);
    });

    it('refuses a write against another member’s venture', async () => {
      // RLS, reached the way the app reaches it. A refusal here is a real PostgREST response
      // with a real SQLSTATE, which is what `ledgerRefusalMessage` classifies on.
      h.become(outsider);
      await expect(
        sendMoneyEntry({
          id: crypto.randomUUID(),
          ventureId,
          occurredOn: today,
          direction: 'in',
          amountMinor: '999',
          currency: 'GBP',
          category: 'sale',
          isRecurring: false,
          note: null,
        }),
      ).rejects.toBeTruthy();
    });
  });

  describe('the Forge writes', () => {
    it('files a SITREP and reads it back on the next load', async () => {
      h.become(memberA);
      const before = await loadForge(memberA.id, today);
      const live = before?.protocols.filter((p) => p.activatesOnDay <= 3) ?? [];
      expect(live.length).toBeGreaterThan(0);

      const result = await sendSitrep({
        enrollmentId: before!.enrollment!.id,
        localDate: today,
        finalStatus: 'complete',
        resetKind: null,
        protocolsFailed: [],
        results: live.map((p) => ({ protocolId: p.id, status: 'pass', medOptionId: null })),
      });
      expect(result.sitrepId).toBeTruthy();

      // `sitrepId` is the row the debrief hangs off, and `filed` is the readback of the
      // results. Both come from the load, so a write that succeeded but did not become
      // readable — the shape a mis-scoped RLS policy produces — fails here.
      const after = await loadForge(memberA.id, today);
      expect(after?.sitrepId).toBe(result.sitrepId);
      expect(after?.filed).not.toBeNull();
      expect(Object.keys(after?.filed ?? {}).length).toBe(live.length);
    });

    it('files a debrief and reads the tactic back — the query that was a 400', async () => {
      // The exact regression: the debrief and its Bottom G tactic came back through an embed
      // PostgREST could not resolve. They are two queries now, and this proves the tactic
      // actually arrives rather than being silently dropped by the fallback.
      h.become(memberA);
      const loaded = await loadForge(memberA.id, today);

      await sendDebrief({
        sitrepId: loaded!.sitrepId!,
        systemUsed: 'Laid gym clothes out the night before',
        victory: 'Out the door before the negotiation started',
        insightProtocolId: null,
        attacked: true,
        outcome: 'lost',
        occurredAtHour: 15,
        triggerKind: 'low_energy',
        propaganda: 'You have earned a break',
        attackedProtocolId: null,
      });

      const after = await loadForge(memberA.id, today);
      expect(after?.filedDebrief?.draft.attacked).toBe(true);
      expect(after?.filedDebrief?.draft.occurredAtHour).toBe(15);
      expect(after?.filedDebrief?.triggerKind).toBe('low_energy');
      expect(after?.filedDebrief?.draft.propaganda).toBe('You have earned a break');
    });

    it('shows a peer the day but never the tactic', async () => {
      // ADR-013's split, verified through the API rather than through SQL. A peer reading
      // `bottom_g_tactics` gets zero rows, so the pattern panel has nothing to draw.
      h.become(peerA);
      const loaded = await loadForge(peerA.id, today);
      expect(loaded?.attacks ?? []).toEqual([]);
    });

    it('lets the mentor see what the disclosure says he sees', async () => {
      h.become(mentorA);
      const { rows } = await h.db.query<{ n: string }>(
        `select count(*)::text as n from public.bottom_g_tactics`,
      );
      expect(rows[0]?.n).toBe('1');

      const response = await fetch(
        `${process.env['VITE_SUPABASE_URL']}/rest/v1/bottom_g_tactics?select=trigger_kind`,
        { headers: { apikey: 'local-e2e-not-a-key' } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{ trigger_kind: 'low_energy' }]);
    });
  });

  describe('the session boundary', () => {
    it('gives anon nothing, holding the public key', async () => {
      // §3.3: the anon key ships in the bundle. This is that key, against the real server.
      h.become(null);
      for (const table of ['ventures', 'money_entries', 'bottom_g_tactics', 'sitreps']) {
        const response = await fetch(
          `${process.env['VITE_SUPABASE_URL']}/rest/v1/${table}?select=*`,
          { headers: { apikey: 'local-e2e-not-a-key' } },
        );
        const body = await response.json();
        expect(Array.isArray(body) ? body : [], `anon read ${table}`).toEqual([]);
      }
    });

    it('refuses a token this server did not sign', async () => {
      const response = await fetch(`${process.env['VITE_SUPABASE_URL']}/rest/v1/app_meta`, {
        headers: { apikey: 'x', Authorization: 'Bearer not.a.token' },
      });
      expect(response.status).toBe(401);
    });
  });
});
