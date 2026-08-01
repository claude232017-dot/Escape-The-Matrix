import { createServer, type Server } from 'node:http';
import { Client } from 'pg';
import { applyMigrations } from '../../scripts/db/apply-migrations.ts';
import { mintToken, startPostgrest, type RunningPostgrest } from '../../scripts/db/postgrest.ts';

/**
 * The fixture for the end-to-end suite: a real PostgREST, and a way to be a real member.
 *
 * ---------------------------------------------------------------------------
 * Why there is a proxy in front of PostgREST
 * ---------------------------------------------------------------------------
 * The point of this suite is to run **the application's own query code** — `loadForge`,
 * `sendVenture`, `sendSitrep` — not a re-typing of it in a test file. A test that restates
 * the queries proves the restatement works, which is exactly the hole the 400 lived in for
 * a week.
 *
 * Those functions call `getSupabase()`, which builds a real `@supabase/supabase-js` client.
 * That client does two things this needs handling for: it appends `/rest/v1` to the
 * configured URL, and it attaches whatever session it holds — and there is no GoTrue here to
 * give it one.
 *
 * So a fifty-line proxy sits in front, strips the prefix, and swaps the Authorization header
 * for the current actor's token. That is precisely GoTrue's job in production: decide who
 * the caller is and say so in a header PostgREST trusts. Standing in for it here leaves the
 * client, the queries and every policy completely untouched and real.
 */

const CONNECTION = process.env['DATABASE_URL'];

/** The address the tests configure `VITE_SUPABASE_URL` with. Fixed so the config can name it. */
export const PROXY_PORT = 54_321;
export const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

export interface Actor {
  id: string;
  email: string;
  token: string;
}

export interface Harness {
  db: Client;
  /** Everything below runs as this actor until it is set again. Null means anon. */
  become: (actor: Actor | null) => void;
  signUp: (email: string, circleId: string, role?: string, tz?: string) => Promise<Actor>;
  stop: () => Promise<void>;
}

/** Anon, until a test says otherwise. */
let current: Actor | null = null;

export async function startHarness(): Promise<Harness> {
  if (!CONNECTION) throw new Error('DATABASE_URL is required for the end-to-end suite.');

  await applyMigrations(CONNECTION, { withShim: true, fresh: true });

  let server: RunningPostgrest;
  try {
    server = await startPostgrest(CONNECTION);
  } catch (cause) {
    // Distinguishable from "the database is down", because the fix is different: this one
    // needs a binary, and the suite is meant to be skippable without one.
    throw new Error(
      `Could not start PostgREST, so the end-to-end suite did NOT run. ` +
        `Set POSTGREST_BIN to a local binary, or unset RUN_API to skip deliberately. ` +
        `Original error: ${(cause as Error).message}`,
      { cause },
    );
  }

  const proxy = await listen(server.url);

  const db = new Client({ connectionString: CONNECTION });
  await db.connect();

  return {
    db,
    become: (actor) => {
      current = actor;
    },
    signUp: (email, circleId, role = 'member', tz = 'UTC') => signUp(db, email, circleId, role, tz),
    stop: async () => {
      current = null;
      await db.end();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await server.stop();
    },
  };
}

/** The invite → auth.users → trigger path, which is how every member really comes to exist. */
async function signUp(
  db: Client,
  email: string,
  circleId: string,
  role: string,
  tz: string,
): Promise<Actor> {
  await db.query(
    `insert into public.invitations (circle_id, email, role, token, expires_at)
     values ($1, lower($2), $3::public.member_role,
             encode(extensions.gen_random_bytes(16), 'hex'), now() + interval '7 days')`,
    [circleId, email, role],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values (lower($1), jsonb_build_object('timezone', $2::text)) returning id`,
    [email, tz],
  );
  const id = rows[0]!.id;
  return { id, email, token: mintToken({ sub: id, role: 'authenticated', email }) };
}

function listen(target: string): Promise<Server> {
  const server = createServer((req, res) => {
    // supabase-js talks to `${url}/rest/v1/...`; PostgREST serves from the root.
    const path = (req.url ?? '/').replace(/^\/rest\/v1/, '') || '/';

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // Hop-by-hop and length headers are rebuilt by fetch; forwarding them corrupts the body.
      if (['host', 'connection', 'content-length', 'authorization'].includes(key)) continue;
      if (typeof value === 'string') headers[key] = value;
    }
    // GoTrue's contribution, in one line: say who is calling.
    headers['Authorization'] = `Bearer ${current?.token ?? mintToken({ role: 'anon' })}`;

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      fetch(`${target}${path}`, {
        method: req.method ?? 'GET',
        headers,
        ...(body.length > 0 ? { body } : {}),
      })
        .then(async (upstream) => {
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (key === 'content-encoding' || key === 'content-length') return;
            res.setHeader(key, value);
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        })
        .catch((cause: Error) => {
          res.statusCode = 502;
          res.end(JSON.stringify({ message: `proxy: ${cause.message}` }));
        });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PROXY_PORT, '127.0.0.1', () => resolve(server));
  });
}
