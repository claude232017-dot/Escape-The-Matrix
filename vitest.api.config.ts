import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { PROXY_URL } from './tests/api/harness.ts';

/**
 * The API suite: the application's own query code, against a real PostgREST.
 *
 * Its own config and its own run, like the database suite, because it starts a server and
 * is therefore slower and strictly serial.
 *
 * The env block is what makes `getSupabase()` — the real one, unmodified — point at the
 * local stack. `VITE_SUPABASE_ANON_KEY` is never verified by anything here: the proxy
 * replaces the Authorization header, which is the job GoTrue does in production. It has to
 * be *present*, because the client refuses to build without it, so its value says what it
 * is instead of pretending to be a key.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      TZ: 'America/New_York',
      VITE_SUPABASE_URL: PROXY_URL,
      VITE_SUPABASE_ANON_KEY: 'local-e2e-not-a-key',
    },
  },
});
