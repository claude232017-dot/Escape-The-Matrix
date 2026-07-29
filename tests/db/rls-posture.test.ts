import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The standing guardrail on the database's security posture.
 *
 * It applies the real migrations to a real Postgres and then interrogates the catalogue.
 * Every later phase adds tables; this test is what stops one of them shipping without
 * RLS, or with a `USING (true)` left over from a debugging session — which looks exactly
 * like a correct policy in a diff.
 *
 * Requires DATABASE_URL. Skipped, loudly, when it is absent, so a developer without a
 * local Postgres is not blocked — but CI always sets it, so the check is never silently
 * absent where it matters.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

/**
 * Tables where an unconditional `USING (true)` is a deliberate decision rather than an
 * oversight. Each entry needs a reason, and adding one should feel like a decision —
 * that is the entire point of making the list explicit instead of exempting a pattern.
 */
const UNCONDITIONAL_READ_IS_INTENTIONAL: Record<string, string> = {
  'public.app_meta':
    'Schema and doctrine version. Global, non-personal, and readable by any signed-in ' +
    'member by design; there is no per-member dimension to restrict it on.',
};

/**
 * Tables where `FORCE ROW LEVEL SECURITY` is deliberately absent.
 *
 * Phase 0 asserted FORCE on every table. That was wrong, and Phase 1 is where it broke:
 * FORCE makes the *table owner* subject to the table's policies, and the owner is exactly
 * who `SECURITY DEFINER` functions run as. A signup trigger that must read
 * `public.invitations` before any session exists has `auth.uid() = null`, so under FORCE
 * the mentor-only policy matches nothing and **every signup is rejected**.
 *
 * FORCE is not load-bearing in this architecture: application traffic arrives through
 * PostgREST as `anon` or `authenticated` and never as the owner, so FORCE constrains only
 * migrations and the trigger functions — both of which are trusted code in this
 * repository. What actually enforces isolation is the policies plus the grants, and those
 * are asserted directly by tests/db/identity-rls.test.ts.
 *
 * The exemption is a list with reasons rather than a dropped assertion, so a future table
 * cannot lose FORCE silently.
 */
const FORCE_RLS_NOT_REQUIRED: Record<string, string> = {
  'public.profiles':
    'app.create_profile_for_new_user() INSERTs here as the owner during signup. There is ' +
    'no INSERT policy by design (profiles are created only by that trigger), so under ' +
    'FORCE the insert would be denied and every new member would get an account with no ' +
    'profile.',
  'public.invitations':
    'app.enforce_invite_only() and app.create_profile_for_new_user() read here as the ' +
    'owner before the user has a session. Under FORCE, auth.uid() is null, the ' +
    'mentor-only policy matches nothing, and every signup is rejected.',
};

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
}

describeDb('database security posture', () => {
  let client: Client;

  beforeAll(async () => {
    try {
      await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    } catch (error) {
      // A bare ECONNREFUSED here reads as a broken test suite rather than a missing
      // server, and the next person loses ten minutes to it. Name the cause and both
      // ways out — the suite is meant to be skippable, but only deliberately.
      const cause = error as NodeJS.ErrnoException;
      if (cause.code === 'ECONNREFUSED' || cause.code === 'ENOTFOUND') {
        throw new Error(
          `DATABASE_URL is set but nothing is listening on it, so the RLS posture was ` +
            `NOT verified. Start Postgres (see docs/RUNBOOK.md) or unset DATABASE_URL to ` +
            `skip these tests deliberately. Original error: ${cause.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    client = new Client({ connectionString: CONNECTION });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it('applies every migration cleanly from an empty database', async () => {
    const { rows } = await client.query<{ schema_version: number; doctrine_version: string }>(
      'select schema_version, doctrine_version from public.app_meta',
    );
    expect(rows).toHaveLength(1);
    // Bumped by the latest migration. Asserting the exact number rather than ">= 1" so
    // that a migration which forgets to bump it is caught here.
    expect(rows[0]?.schema_version).toBe(2);
    expect(rows[0]?.doctrine_version).toBe('2026.07-draft');
  });

  it('re-applies cleanly, because a human will paste this into a SQL editor', async () => {
    // The first deployment is done by hand against Supabase, so "run it twice by
    // accident" is a realistic event rather than a hypothetical. A migration that
    // half-applies and then errors leaves someone unpicking state at the worst moment.
    // `create domain` has no IF NOT EXISTS — that was the real failure this catches.
    await applyMigrations(CONNECTION as string, { withShim: false, fresh: false });
    await applyMigrations(CONNECTION as string, { withShim: false, fresh: false });

    const { rows } = await client.query<{ count: string }>(
      'select count(*)::text as count from public.app_meta',
    );
    expect(rows[0]?.count, 'app_meta gained rows on re-apply').toBe('1');

    const domains = await client.query<{ count: string }>(
      `select count(*)::text as count from pg_type
        where typnamespace = 'app'::regnamespace and typtype = 'd'`,
    );
    expect(domains.rows[0]?.count).toBe('2');
  });

  it('enables row-level security on every table in public', async () => {
    const { rows } = await client.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity
         from pg_tables
        where schemaname = 'public'
        order by tablename`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    expect(unprotected, `tables in public without RLS: ${unprotected.join(', ')}`).toEqual([]);
  });

  it('forces row-level security except where a signup trigger must bypass it', async () => {
    // Without FORCE, the owning role bypasses its own policies — which is required for the
    // signup triggers and wrong for everything else. Hence a reasoned exemption list
    // rather than either a blanket assertion or a dropped one.
    const { rows } = await client.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select c.relname, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    const unexplained = rows
      .filter((r) => !r.relforcerowsecurity)
      .filter((r) => !(`public.${r.relname}` in FORCE_RLS_NOT_REQUIRED))
      .map((r) => r.relname);
    expect(
      unexplained,
      'tables without FORCE RLS that are not recorded as intentional — either force it ' +
        'or add the table to FORCE_RLS_NOT_REQUIRED with the reason',
    ).toEqual([]);
  });

  it('keeps the FORCE exemption list honest', async () => {
    // An exemption for a table that has since gained FORCE, or that no longer exists, is
    // stale documentation pretending to be a decision.
    const { rows } = await client.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select c.relname, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((r) => [`public.${r.relname}`, r.relforcerowsecurity]));
    for (const exempt of Object.keys(FORCE_RLS_NOT_REQUIRED)) {
      expect(byName.has(exempt), `${exempt} is exempted but does not exist`).toBe(true);
      expect(byName.get(exempt), `${exempt} is exempted but now has FORCE — drop the exemption`).toBe(
        false,
      );
    }
  });

  it('leaves no table with RLS enabled but no policy at all', async () => {
    // Such a table is not "secure by accident" — it is unreadable, which surfaces later
    // as an empty screen nobody can explain.
    const { rows } = await client.query<{ tablename: string }>(
      `select t.tablename
         from pg_tables t
        where t.schemaname = 'public'
          and t.rowsecurity
          and not exists (
            select 1 from pg_policies p
             where p.schemaname = t.schemaname and p.tablename = t.tablename
          )`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('has no unreviewed USING (true) policy', async () => {
    const { rows } = await client.query<PolicyRow>(
      `select schemaname, tablename, policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public'`,
    );

    const unconditional = rows.filter((r) => normalise(r.qual) === 'true');
    const unexplained = unconditional.filter(
      (r) => !(`${r.schemaname}.${r.tablename}` in UNCONDITIONAL_READ_IS_INTENTIONAL),
    );

    expect(
      unexplained.map((r) => `${r.tablename}.${r.policyname} (${r.cmd})`),
      'policies with USING (true) that are not recorded as intentional — either scope ' +
        'them or add them to UNCONDITIONAL_READ_IS_INTENTIONAL with a reason',
    ).toEqual([]);
  });

  it('never grants an unconditional write', async () => {
    // A permissive read can be a judgement call. A permissive write never is: nothing in
    // this product is writable by everyone.
    const { rows } = await client.query<PolicyRow>(
      `select schemaname, tablename, policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and cmd <> 'SELECT'`,
    );
    const permissiveWrites = rows.filter(
      (r) => normalise(r.qual) === 'true' || normalise(r.with_check) === 'true',
    );
    expect(
      permissiveWrites.map((r) => `${r.tablename}.${r.policyname} (${r.cmd})`),
      'write policies with an unconditional USING/WITH CHECK',
    ).toEqual([]);
  });

  it('grants nothing in public to the anon role', async () => {
    // There is no public signup and no anonymous surface. An anon grant is always a bug.
    const { rows } = await client.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(
      rows.map((r) => `${r.table_name}:${r.privilege_type}`),
      'the anon role holds grants in public; this app has no anonymous surface',
    ).toEqual([]);
  });

  it('does not expose the app helper schema through the API', async () => {
    const { rows } = await client.query<{ has: boolean }>(
      `select has_schema_privilege('authenticated', 'app', 'usage') as has`,
    );
    expect(rows[0]?.has).toBe(false);
  });

  it('caps structured prose in the database, not only in the browser', async () => {
    // The client-side cap gives a fast error; this is what makes the rule true.
    await expect(
      client.query(`select ('${'x'.repeat(141)}')::app.capped_text_140`),
    ).rejects.toThrow(/capped_text_140/);
    await expect(client.query(`select ('${'x'.repeat(140)}')::app.capped_text_140`)).resolves
      .toBeDefined();
  });

  it('rejects a malformed currency code at the storage layer', async () => {
    await expect(client.query(`select ('usd')::app.currency_code`)).rejects.toThrow(
      /currency_code_format/,
    );
    await expect(client.query(`select ('USD')::app.currency_code`)).resolves.toBeDefined();
  });

  it('keeps app_meta to a single row by constraint', async () => {
    await expect(
      client.query(`insert into public.app_meta (id, schema_version, doctrine_version)
                    values (false, 2, 'x')`),
    ).rejects.toThrow(/app_meta_single_row/);
  });
});

/** Postgres reformats policy expressions; compare on a normalised form. */
function normalise(expression: string | null): string | null {
  if (expression === null) return null;
  return expression.trim().replace(/^\((.*)\)$/s, '$1').trim().toLowerCase();
}
