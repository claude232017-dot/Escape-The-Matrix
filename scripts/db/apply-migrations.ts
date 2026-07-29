import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { Client } from 'pg';

/**
 * Applies the shim and then every migration, in filename order, to `DATABASE_URL`.
 *
 * Each migration runs in its own transaction: a migration that fails half-way leaves
 * nothing behind, so a failed run is re-runnable rather than requiring someone to work
 * out by hand which statements landed.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
const SHIM = fileURLToPath(new URL('../../supabase/local/00_shim.sql', import.meta.url));

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export interface ApplyOptions {
  /** Apply the local Supabase stand-in first. Never true against a real project. */
  withShim: boolean;
  /** Drop and recreate `public` and `app` first, so a run starts from nothing. */
  fresh: boolean;
  log?: (message: string) => void;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Refuse to drop the schema of anything that is not a local throwaway database.
 *
 * `fresh` issues `drop schema public cascade`. The test harness sets it on every run, and
 * `DATABASE_URL` is the same variable used to point at a real Supabase project — so a
 * single stale export in a shell is the whole distance between "run the tests" and
 * "destroy production". That is too short a distance for a flag nobody re-reads.
 *
 * The override exists because a remote *throwaway* database is a legitimate thing to
 * reset in CI; it has to be stated deliberately, per invocation.
 */
function assertSafeToReset(connectionString: string): void {
  if (process.env['ALLOW_DESTRUCTIVE_DB_RESET'] === '1') return;

  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // An unparseable connection string is not demonstrably local, so it is not safe.
    host = '<unparseable>';
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to drop the public schema on non-local host ${JSON.stringify(host)}.\n` +
        `This would run "drop schema public cascade" and destroy every table there, ` +
        `including any not created by this project.\n` +
        `If that is genuinely what you want on a throwaway database, re-run with ` +
        `ALLOW_DESTRUCTIVE_DB_RESET=1.`,
    );
  }
}

export async function applyMigrations(
  connectionString: string,
  options: ApplyOptions,
): Promise<string[]> {
  const log = options.log ?? (() => {});
  // Checked before a connection is even opened, so the destructive path cannot be
  // reached by a partially-successful run.
  if (options.fresh) assertSafeToReset(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    if (options.fresh) {
      await client.query('drop schema if exists app cascade');
      await client.query('drop schema if exists public cascade');
      await client.query('create schema public');
    }
    if (options.withShim) {
      await client.query('begin');
      await client.query(readFileSync(SHIM, 'utf8'));
      await client.query('commit');
      log('applied shim (local only)');
    }
    for (const file of migrationFiles()) {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

// Direct invocation: `node scripts/db/apply-migrations.ts`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    process.stderr.write('DATABASE_URL is not set\n');
    process.exit(1);
  }
  const applied = await applyMigrations(connectionString, {
    withShim: process.argv.includes('--shim'),
    fresh: process.argv.includes('--fresh'),
    log: (m) => process.stdout.write(`${m}\n`),
  });
  process.stdout.write(`${applied.length} migration(s) applied\n`);
}
