import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * A real PostgREST, for tests that need the real API.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Two suites covered this application and neither covered the seam between them. The
 * database tests talk to Postgres directly with `pg`, so they issue SQL nobody's browser
 * ever issues. The browser tests drive a harness with fixture data and no session, so they
 * never make a request at all. Between them sat PostgREST, which is what every real write
 * actually goes through — and that is precisely where the bug lived:
 *
 *   - `permission denied for schema app` on naming a venture, because PostgREST emits a
 *     schema-qualified cast for a domain column and the DB tests wrote bare literals.
 *   - a 400 on every single page load, because an embed named two tables with no foreign
 *     key between them and only PostgREST knows or cares.
 *
 * Both shipped with 666 tests green. Neither could have.
 *
 * ---------------------------------------------------------------------------
 * What this is not
 * ---------------------------------------------------------------------------
 * It is not the Supabase stack. GoTrue is absent, so signup, the two auth triggers,
 * password recovery and §3.7's ordering are **not** covered here — they remain covered by
 * the browser suite and by the bootstrap being run by hand. That gap is recorded in
 * docs/SECURITY.md §5 rather than papered over.
 *
 * What is covered is everything that happens once a man has a session, which is every read
 * and every write in the application.
 *
 * ---------------------------------------------------------------------------
 * How a session is faked, and why that is honest
 * ---------------------------------------------------------------------------
 * A Supabase session is an HS256 JWT signed with the project's secret, carrying `sub` and
 * `role`. PostgREST verifies the signature and sets `request.jwt.claims`, which is the only
 * thing `auth.uid()` and every RLS policy in this schema ever reads. So a token minted here
 * with the same secret is not a mock of a session — for every purpose below the auth
 * server, it *is* one. GoTrue's job is deciding who gets a token; this skips that and tests
 * what the token then permits.
 */

/** The signing secret. Arbitrary, local-only, and shared between this and the token minter. */
export const JWT_SECRET = 'etm-local-test-secret-at-least-32-characters-long';

/**
 * Mirror note: `POSTGREST_VERSION` in .github/workflows/ci.yml, where it is also the cache
 * key. If they drift, a developer tests against a different server than CI does — which is
 * the same class of gap this whole file exists to close. Pinned together by
 * tests/unit/postgrest-version.test.ts.
 */
export const POSTGREST_VERSION = 'v12.2.3';
const POSTGREST_URL_BASE = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}`;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * An HS256 JWT for `role`, optionally as the member `sub`.
 *
 * Deliberately hand-rolled rather than pulling in a JWT library: the point of this file is
 * to prove what the *server* accepts, and a token minted by the same library the server
 * uses would hide a whole class of disagreement. Three base64url segments and an HMAC is
 * the entire specification.
 */
export function mintToken(claims: { sub?: string; role: string; email?: string }): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      ...claims,
      // An hour is longer than any test run and short enough that a leaked token from a CI
      // log is worthless. PostgREST rejects an expired token with 401, which is itself
      // asserted in the suite.
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  );
  const signature = base64url(
    createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

/**
 * The PostgREST binary, downloaded once and cached.
 *
 * Cached outside the repository so a clean checkout does not re-fetch, and so it can never
 * be committed by accident. `POSTGREST_BIN` short-circuits the whole thing for CI images or
 * air-gapped machines that ship their own.
 */
async function ensureBinary(): Promise<string> {
  const provided = process.env['POSTGREST_BIN'];
  if (provided) {
    if (!existsSync(provided)) {
      throw new Error(`POSTGREST_BIN is set to ${provided}, which does not exist.`);
    }
    return provided;
  }

  const cacheDir = join(tmpdir(), `etm-postgrest-${POSTGREST_VERSION}`);
  const binary = join(cacheDir, 'postgrest');
  if (existsSync(binary)) return binary;

  await mkdir(cacheDir, { recursive: true });
  const asset = `postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz`;
  const response = await fetch(`${POSTGREST_URL_BASE}/${asset}`);
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download PostgREST ${POSTGREST_VERSION} (HTTP ${response.status}). ` +
        `Set POSTGREST_BIN to a local binary, or unset POSTGREST_URL to skip these tests.`,
    );
  }

  const archive = join(cacheDir, asset);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archive));
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['xf', archive, '-C', cacheDir], { stdio: 'ignore' });
    tar.on('error', reject);
    tar.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code} unpacking PostgREST`)),
    );
  });
  await chmod(binary, 0o755);
  return binary;
}

export interface RunningPostgrest {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Start PostgREST against `databaseUrl` and wait until it actually answers.
 *
 * It connects as `authenticator`, the role the Supabase shim already creates, which can
 * assume `anon` and `authenticated` and nothing else. That is the same privilege shape the
 * hosted platform uses, so a policy that passes here passes there for the same reason.
 */
export async function startPostgrest(
  databaseUrl: string,
  port = 3999,
): Promise<RunningPostgrest> {
  const binary = await ensureBinary();
  const url = `http://127.0.0.1:${port}`;

  // Configured entirely through the environment rather than a config file, so there is no
  // temp file to write, find on a failure, or leave behind on a crash.
  const child: ChildProcess = spawn(binary, [], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PGRST_DB_URI: databaseUrl,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(port),
      PGRST_DB_POOL: '4',
      // The schema cache is built at boot. Migrations are applied *before* this starts, so
      // there is nothing to reload — but if that order is ever reversed, a stale cache
      // reports "relation does not exist" for a table that plainly does, which is a
      // genuinely baffling half hour. Named here so it is a short one.
      PGRST_DB_CONFIG: 'false',
    },
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`PostgREST exited ${child.exitCode} during startup:\n${stderr}`);
    }
    try {
      const probe = await fetch(`${url}/app_meta?select=schema_version&limit=1`, {
        headers: { Authorization: `Bearer ${mintToken({ role: 'authenticated' })}` },
      });
      // Listening is not the same as ready. PostgREST binds the port, *then* builds its
      // schema cache, and answers 503 PGRST002 in between — so "any HTTP response" as a
      // readiness signal hands the suite a server that 503s every query it makes. The only
      // honest probe is one real request against a real table.
      //
      // 200 is ready. So is any 4xx: the cache is loaded and the request was understood
      // well enough to be refused, which is all this needs to know.
      if (probe.status !== 503) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`PostgREST did not become ready within 30s:\n${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        // A test run that leaves a server holding port 3999 makes the *next* run fail with
        // something unrelated, so this does not wait politely for ever.
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 3000).unref();
      }),
  };
}
