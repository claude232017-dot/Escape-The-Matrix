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

export async function applyMigrations(
  connectionString: string,
  options: ApplyOptions,
): Promise<string[]> {
  const log = options.log ?? (() => {});
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
