import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * Every PostgREST embed in the client resolves to a real foreign key.
 *
 * This test exists because one did not, and it shipped.
 *
 * `use-forge-data.ts` asked for the day's debrief with the attack embedded under it:
 *
 *     .from('debriefs').select('…, bottom_g_tactics!inner(occurred_at_hour, …)')
 *
 * `bottom_g_tactics` has a foreign key to `sitreps`, not to `debriefs`. PostgREST has no
 * relationship to resolve between those two tables, so it answered **400 on every single load**.
 * A fallback query underneath meant the screen still rendered, which is precisely why nobody
 * noticed: the only symptom was a red line in a console, and an extra round trip on a phone.
 *
 * An embed is a join written as a string. Nothing typechecks it, no unit test covers it without
 * a live PostgREST, and it fails at runtime in a way that looks like it works. So the check is
 * done here, against the real catalogue: parse the embeds out of the source, and for each one
 * assert a foreign key actually exists between the two tables.
 *
 * Mirror: src/features/forge/use-forge-data.ts, src/features/ledger/use-ledger-data.ts.
 */

const CONNECTION = process.env['DATABASE_URL'];
const describeDb = CONNECTION ? describe : describe.skip;

interface Embed {
  /** The table the embed hangs off — the `.from()` table, or an enclosing embed. */
  parent: string;
  /** The embedded table, with any `alias:` prefix and `!inner`/`!left` hint stripped. */
  child: string;
  source: string;
}

/** Every .ts/.tsx under src, so a new feature is covered without editing this list. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Pull the embedded resource names out of one select string, keeping track of nesting.
 *
 * `sitreps!inner(local_date, enrollments!inner(profile_id))` selected from `debriefs` is two
 * embeds — debriefs→sitreps and sitreps→enrollments — not debriefs→enrollments. Getting that
 * wrong would make the test pass for the wrong reason.
 */
function parseEmbeds(select: string, from: string, source: string): Embed[] {
  const found: Embed[] = [];
  const stack: string[] = [from];
  let token = '';

  for (const char of select) {
    if (char === '(') {
      const name = token.trim().split(':').pop()?.split('!')[0]?.trim() ?? '';
      const parent = stack[stack.length - 1];
      if (name && parent) found.push({ parent, child: name, source });
      stack.push(name);
      token = '';
    } else if (char === ')') {
      stack.pop();
      token = '';
    } else if (char === ',') {
      token = '';
    } else {
      token += char;
    }
  }
  return found;
}

/** `.from('x')` followed by `.select('…')`, including selects broken across lines. */
function embedsIn(source: string, code: string): Embed[] {
  const pattern = /\.from\(\s*'([a-z_]+)'\s*\)\s*(?:\.[a-zA-Z]+\([^)]*\)\s*)*?\.select\(\s*([\s\S]*?)\)\s*(?:\.|;|$)/g;
  const embeds: Embed[] = [];
  for (const match of code.matchAll(pattern)) {
    const from = match[1];
    const raw = match[2];
    if (!from || !raw) continue;
    // The select argument may be a single quoted string or a concatenation across lines; take
    // the contents of every quoted chunk and stitch them back together.
    const select = [...raw.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
    if (select) embeds.push(...parseEmbeds(select, from, source));
  }
  return embeds;
}

describeDb('PostgREST embeds resolve to real foreign keys', () => {
  let client: Client;
  let relationships: Set<string>;
  let embeds: Embed[];

  beforeAll(async () => {
    await applyMigrations(CONNECTION as string, { withShim: true, fresh: true });
    client = new Client({ connectionString: CONNECTION });
    await client.connect();

    // PostgREST can embed in either direction across a foreign key, so record both.
    const { rows } = await client.query<{ child: string; parent: string }>(
      `select conrelid::regclass::text as child, confrelid::regclass::text as parent
         from pg_constraint
        where contype = 'f'
          and connamespace = 'public'::regnamespace`,
    );
    relationships = new Set(
      rows.flatMap(({ child, parent }) => {
        const c = child.replace(/^public\./, '');
        const p = parent.replace(/^public\./, '');
        return [`${c}->${p}`, `${p}->${c}`];
      }),
    );

    embeds = sourceFiles('src').flatMap((file) => embedsIn(file, readFileSync(file, 'utf8')));
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it('finds the embeds it is meant to be checking', () => {
    // Without this, a parser that silently matched nothing would make the suite green and the
    // guarantee worthless. The two known embeds both go through `sitreps`.
    expect(embeds.length).toBeGreaterThanOrEqual(2);
    expect(embeds.map((e) => `${e.parent}->${e.child}`)).toContain('sitreps->enrollments');
  });

  it('has a foreign key behind every embed', () => {
    const unresolvable = embeds
      .filter((e) => !relationships.has(`${e.parent}->${e.child}`))
      .map((e) => `${e.source}: ${e.parent} -> ${e.child}`);

    expect(
      unresolvable,
      'PostgREST answers 400 for an embed with no foreign key between the tables',
    ).toEqual([]);
  });

  it('rejects the embed that actually shipped', () => {
    // The regression, stated directly: whatever else changes, this pair must stay unresolvable,
    // because the day `bottom_g_tactics` gains a foreign key to `debriefs` the original query
    // becomes legal and this test should stop claiming otherwise.
    expect(relationships.has('debriefs->bottom_g_tactics')).toBe(false);
  });
});
