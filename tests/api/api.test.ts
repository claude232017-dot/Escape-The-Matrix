import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadForge } from '@/features/forge/use-forge-data';
import { sendSitrep } from '@/features/forge/sitrep-write';
import { sendDebrief } from '@/features/forge/debrief-write';
import { sendBusinessDay, sendMoneyEntry, sendVenture } from '@/features/ledger/ledger-write';
import { loadWeek } from '@/features/week/use-week-data';
import { loadCommand } from '@/features/command/use-command-data';
import { sendDirective } from '@/features/command/directive-write';
import { loadPlaybooks } from '@/features/playbooks/use-playbook-data';
import { deleteAccount, exportFilename, fetchExport } from '@/features/account/account-write';
import {
  adoptPlaybook,
  answerApplication,
  promotePlaybook,
} from '@/features/playbooks/playbook-write';
import {
  sendCommitments,
  sendSettlement,
  withdrawCommitment,
} from '@/features/week/commitment-write';
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

  describe('the week', () => {
    it('declares a slate and reads it back', async () => {
      h.become(memberA);
      const { rows } = await h.db.query<{ monday: string }>(
        `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday`,
        [memberA.id],
      );
      const monday = rows[0]!.monday;

      const result = await sendCommitments({
        weekStart: monday,
        bodies: ['Ten sales calls', 'Ship the landing page'],
      });
      expect(result.written).toBe(2);

      const loaded = await loadWeek(memberA.id, today);
      expect(loaded.current.commitments.map((c) => c.body)).toEqual([
        'Ten sales calls',
        'Ship the landing page',
      ]);
      // `declared_on` is stamped by the database, never sent — so this is the server's answer
      // to "when did he actually declare it", not the client's claim.
      expect(loaded.current.commitments[0]?.declaredOn).toBe(today);
    });

    it('resolves the embed on profiles rather than answering 400', async () => {
      // The week query embeds `profiles!inner(display_name)` so the circle panel can put a name
      // beside a commitment. That embed is the same shape as the one that answered 400 on every
      // Forge load for a week, so it is exercised against a real server rather than trusted.
      h.become(memberA);
      const loaded = await loadWeek(memberA.id, today);
      expect(loaded.circle.length).toBeGreaterThan(0);
      expect(loaded.circle[0]?.displayName).not.toBe('—');
    });

    it('shows a peer what the circle declared, as the disclosure says', async () => {
      h.become(peerA);
      const loaded = await loadWeek(peerA.id, today);
      const names = new Set(loaded.circle.map((c) => c.displayName));
      expect(names.size).toBeGreaterThan(0);
      expect(loaded.current.commitments, 'a peer saw his own week as another man’s').toEqual([]);
    });

    it('gives another circle nothing', async () => {
      h.become(outsider);
      const loaded = await loadWeek(outsider.id, today);
      expect(loaded.circle).toEqual([]);
      expect(loaded.current.commitments).toEqual([]);
    });

    it('refuses a fourth commitment through the real API', async () => {
      h.become(memberA);
      const { rows } = await h.db.query<{ monday: string }>(
        `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday`,
        [memberA.id],
      );
      await expect(
        sendCommitments({
          weekStart: rows[0]!.monday,
          bodies: ['One', 'Two', 'Three', 'Four'],
        }),
      ).rejects.toThrow(/commitments_ceiling/);
    });

    it('refuses to settle a week that is not over', async () => {
      // Unless today is Sunday, in which case settling is exactly what should be allowed. The
      // assertion follows the rule rather than the calendar — see tests/db/commitments-rls.
      h.become(memberA);
      const loaded = await loadWeek(memberA.id, today);
      const first = loaded.current.commitments[0];
      expect(first).toBeDefined();

      const { rows } = await h.db.query<{ dow: string }>(
        `select extract(isodow from app.today_for($1))::text as dow`,
        [memberA.id],
      );
      const settling = sendSettlement({ id: first!.id, outcome: 'hit' });

      if (Number(rows[0]!.dow) < 7) {
        await expect(settling).rejects.toThrow(/commitment_too_early/);
      } else {
        await expect(settling).resolves.toBeUndefined();
      }
    });

    it('refuses a peer settling another man’s commitment', async () => {
      // RLS, through the real API. A refused update is silent in PostgREST — it matches no rows
      // rather than erroring — so the assertion is that the row did not change.
      h.become(memberA);
      const loaded = await loadWeek(memberA.id, today);
      const target = loaded.current.commitments[0]!;

      h.become(peerA);
      await sendSettlement({ id: target.id, outcome: 'hit' }).catch(() => undefined);

      const { rows } = await h.db.query<{ outcome: string }>(
        `select outcome::text from public.commitments where id = $1`,
        [target.id],
      );
      expect(rows[0]?.outcome, 'a peer settled a commitment that was not his').toBe('pending');
    });

    it('withdraws only what he declared today', async () => {
      h.become(memberA);
      const before = await loadWeek(memberA.id, today);
      const target = before.current.commitments.at(-1)!;

      await expect(withdrawCommitment(target.id)).resolves.toBeUndefined();

      const after = await loadWeek(memberA.id, today);
      expect(after.current.commitments.map((c) => c.id)).not.toContain(target.id);
    });
  });

  describe('the Commander’s View', () => {
    it('reads both loops on one row through the view', async () => {
      h.become(memberA);
      const loaded = await loadCommand(memberA.id, today);
      const day = loaded.mine.find((d) => d.localDate === today);

      expect(day, 'the grain returned nothing for today').toBeDefined();
      expect(day?.finalStatus).toBe('complete');
      expect(day?.businessActions).toBe(6);
      expect(day?.revenueMinor).toBe('130000');
    });

    it('keeps bigint revenue a string all the way through PostgREST', async () => {
      // §3.2. A JS number loses pennies above 2^53, and the place that would happen silently is
      // exactly here — the boundary where the wire format is JSON.
      h.become(memberA);
      const loaded = await loadCommand(memberA.id, today);
      const day = loaded.mine.find((d) => d.localDate === today);
      expect(typeof day?.revenueMinor).toBe('string');
    });

    it('blanks another man’s revenue for a peer, through the same query', async () => {
      // The property the whole phase rests on, proved against a real server rather than against
      // `pg`. A peer sees the day; he does not see a penny of it. If `member_days` ever loses
      // `security_invoker`, this is the test that says so in the language of the bug.
      h.become(peerA);
      const loaded = await loadCommand(peerA.id, today);
      const hisDay = loaded.circle.find(
        (d) => d.profileId === memberA.id && d.localDate === today,
      );

      expect(hisDay, 'a peer could not see the day at all').toBeDefined();
      expect(hisDay?.finalStatus).toBe('complete');
      expect(hisDay?.revenueMinor, 'a peer read another man’s revenue').toBe('0');
    });

    it('shows the mentor the revenue, as disclosed', async () => {
      h.become(mentorA);
      const loaded = await loadCommand(mentorA.id, today);
      const hisDay = loaded.circle.find(
        (d) => d.profileId === memberA.id && d.localDate === today,
      );
      expect(hisDay?.revenueMinor).toBe('130000');
    });

    it('gives another circle nothing at all', async () => {
      h.become(outsider);
      const loaded = await loadCommand(outsider.id, today);
      expect(loaded.circle).toEqual([]);
      expect(loaded.mine).toEqual([]);
    });

    it('builds a standing per member the reader can see', async () => {
      h.become(memberA);
      const loaded = await loadCommand(memberA.id, today);
      const mine = loaded.standings.find((s) => s.profileId === memberA.id);
      expect(mine?.displayName).toBeTruthy();
      expect(mine?.lastReported).toBe(today);
      expect(mine?.daysSilent).toBe(0);
    });
  });

  describe('mentor directives', () => {
    it('lets the mentor write one and the subject read it', async () => {
      const { rows } = await h.db.query<{ monday: string }>(
        `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday`,
        [memberA.id],
      );
      const monday = rows[0]!.monday;

      h.become(mentorA);
      await expect(
        sendDirective({
          authorId: mentorA.id,
          subjectId: memberA.id,
          weekStart: monday,
          body: 'Ten offers before Friday. No exceptions.',
        }),
      ).resolves.toBeUndefined();

      h.become(memberA);
      const asSubject = await loadCommand(memberA.id, today);
      expect(asSubject.directives.map((d) => d.body)).toEqual([
        'Ten offers before Friday. No exceptions.',
      ]);
    });

    it('gives a peer nothing, because it is not the circle’s business', async () => {
      // The one place in this schema where the circle is deliberately shut out of something
      // about a member: a directive everyone can read is a public correction.
      h.become(peerA);
      const asPeer = await loadCommand(peerA.id, today);
      expect(asPeer.directives, 'a peer read a directive that was not his').toEqual([]);
    });

    it('refuses a member writing one', async () => {
      const { rows } = await h.db.query<{ monday: string }>(
        `select to_char(app.week_start_for($1), 'YYYY-MM-DD') as monday`,
        [memberA.id],
      );
      h.become(peerA);
      await expect(
        sendDirective({
          authorId: peerA.id,
          subjectId: memberA.id,
          weekStart: rows[0]!.monday,
          body: 'Do as I say',
        }),
      ).rejects.toBeTruthy();
    });
  });

  describe('playbooks', () => {
    let playbookId: string;

    it('lets the mentor promote one and the circle read it', async () => {
      h.become(mentorA);
      await expect(
        promotePlaybook({
          circleId: circleA,
          promotedBy: mentorA.id,
          promotedFrom: null,
          title: 'Clothes out the night before',
          body: 'Lay the kit out before bed so the morning has no decision in it',
        }),
      ).resolves.toBeUndefined();

      h.become(peerA);
      const loaded = await loadPlaybooks();
      expect(loaded.playbooks.map((p) => p.title)).toEqual(['Clothes out the night before']);
      playbookId = loaded.playbooks[0]!.id;
    });

    it('refuses a member promoting one', async () => {
      h.become(memberA);
      await expect(
        promotePlaybook({
          circleId: circleA,
          promotedBy: memberA.id,
          promotedFrom: null,
          title: 'Mine',
          body: 'My system',
        }),
      ).rejects.toBeTruthy();
    });

    it('lets two men adopt and answer', async () => {
      h.become(memberA);
      await adoptPlaybook({ playbookId, profileId: memberA.id, adoptedOn: today });
      let mine = (await loadPlaybooks()).mine;
      await answerApplication({ applicationId: mine[0]!.id, outcome: 'held' });

      h.become(peerA);
      await adoptPlaybook({ playbookId, profileId: peerA.id, adoptedOn: today });
      mine = (await loadPlaybooks()).mine;
      await answerApplication({ applicationId: mine[0]!.id, outcome: 'did_not' });
    });

    it('shows a man the counts without showing him whose failure it was', async () => {
      // The line the whole feature is built around, proved through a real PostgREST: zero
      // application rows for another man, and a correct total, from the same session.
      h.become(peerA);
      const loaded = await loadPlaybooks();

      expect(loaded.mine, 'a peer saw more than his own application').toHaveLength(1);
      expect(loaded.mine[0]?.playbookId).toBe(playbookId);

      const counts = loaded.transfer.get(playbookId);
      expect(counts).toEqual({
        playbookId,
        adopted: 2,
        held: 1,
        didNot: 1,
        pending: 0,
      });
    });

    it('refuses a second adoption by the same man', async () => {
      h.become(memberA);
      await expect(
        adoptPlaybook({ playbookId, profileId: memberA.id, adoptedOn: today }),
      ).rejects.toBeTruthy();
    });

    it('gives another circle nothing, catalogue and counts alike', async () => {
      h.become(outsider);
      const loaded = await loadPlaybooks();
      expect(loaded.playbooks).toEqual([]);
      expect(loaded.mine).toEqual([]);
      expect([...loaded.transfer.keys()]).toEqual([]);
    });
  });

  describe('export and deletion', () => {
    it('returns the sensitive half through the real API', async () => {
      // §3.5's "export includes it", proved at the boundary a browser actually uses. A DB test
      // can prove the function returns it; only this proves it survives PostgREST's JSON.
      h.become(memberA);
      const doc = await fetchExport();

      expect(Array.isArray(doc['sitreps'])).toBe(true);
      expect((doc['bottom_g_tactics'] as unknown[]).length).toBeGreaterThan(0);
      expect((doc['money_entries'] as unknown[]).length).toBeGreaterThan(0);
      expect(doc['profile']).toBeTruthy();
    });

    it('names the file from the server’s clock, not the browser’s', async () => {
      // The export is a record of what the server held. Stamping it with the reader's clock
      // would be a small lie about when.
      h.become(memberA);
      const doc = await fetchExport();
      expect(exportFilename(doc)).toMatch(/^escape-the-matrix-\d{4}-\d{2}-\d{2}\.json$/);
    });

    it('gives one man nothing of another’s', async () => {
      h.become(peerA);
      const doc = await fetchExport();
      expect(doc['bottom_g_tactics']).toEqual([]);
      expect(doc['money_entries']).toEqual([]);
    });

    it('refuses a deletion without the confirming address', async () => {
      h.become(peerA);
      await expect(deleteAccount('not-his@example.com')).rejects.toBeTruthy();

      const { rows } = await h.db.query<{ n: string }>(
        `select count(*)::text as n from public.profiles where id = $1`,
        [peerA.id],
      );
      expect(rows[0]?.n, 'a refused deletion still erased him').toBe('1');
    });

    it('erases him when he confirms, leaving nothing behind', async () => {
      // Run last in this block on purpose: it destroys the actor.
      h.become(peerA);
      await expect(deleteAccount(peerA.email)).resolves.toBeUndefined();

      const { rows } = await h.db.query<{ n: string }>(
        `select (select count(*) from auth.users where id = $1)
              + (select count(*) from public.profiles where id = $1) as n`,
        [peerA.id],
      );
      expect(rows[0]?.n).toBe('0');
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
