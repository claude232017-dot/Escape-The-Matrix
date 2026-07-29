import { describe, expect, it, afterEach } from 'vitest';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';

/**
 * The guard on `fresh`, which issues `drop schema public cascade`.
 *
 * A unit test rather than a database test on purpose: it must run everywhere, on every
 * `npm run verify`, with no Postgres required — because the failure it prevents is
 * irreversible and the person who needs catching is someone with a stale `DATABASE_URL`
 * exported in their shell.
 */

describe('destructive reset guard', () => {
  afterEach(() => {
    delete process.env['ALLOW_DESTRUCTIVE_DB_RESET'];
  });

  it('refuses to drop the schema of a remote host', async () => {
    // A real Supabase connection string shape. If this ever stops throwing, a stale
    // DATABASE_URL plus `npm run db:test` destroys a production schema.
    await expect(
      applyMigrations('postgresql://postgres.abcdefgh:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres', {
        withShim: false,
        fresh: true,
      }),
    ).rejects.toThrow(/Refusing to drop the public schema on non-local host/);
  });

  it('names the host it refused, so the message is actionable', async () => {
    await expect(
      applyMigrations('postgresql://u:p@db.example.com:5432/postgres', {
        withShim: false,
        fresh: true,
      }),
    ).rejects.toThrow(/db\.example\.com/);
  });

  it('treats an unparseable connection string as unsafe', async () => {
    // Fail closed: "I could not tell where this points" is not "it is local".
    await expect(
      applyMigrations('not-a-url', { withShim: false, fresh: true }),
    ).rejects.toThrow(/Refusing to drop/);
  });

  it('allows a deliberate override for throwaway remote databases', async () => {
    process.env['ALLOW_DESTRUCTIVE_DB_RESET'] = '1';
    // Gets past the guard and fails on the connection instead, which is the proof that
    // the guard is what was rejecting it before.
    await expect(
      applyMigrations('postgresql://u:p@db.example.invalid:5432/postgres', {
        withShim: false,
        fresh: true,
      }),
    ).rejects.not.toThrow(/Refusing to drop/);
  });

  it('does not block a non-destructive apply to a remote host', async () => {
    // Applying migrations to production is the normal, intended operation. Only the
    // schema drop is guarded, and guarding the wrong verb would push people to the
    // override out of habit — which is how a safety flag becomes decoration.
    await expect(
      applyMigrations('postgresql://u:p@db.example.invalid:5432/postgres', {
        withShim: false,
        fresh: false,
      }),
    ).rejects.not.toThrow(/Refusing to drop/);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('permits the local host %s', async (host) => {
    await expect(
      applyMigrations(`postgresql://u:p@${host}:1/postgres`, { withShim: false, fresh: true }),
    ).rejects.not.toThrow(/Refusing to drop/);
  });
});
