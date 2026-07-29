import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Database tests, kept in their own config and their own run.
 *
 * Separate from the unit suite because they need a real Postgres, apply migrations, and
 * are therefore slower and serial — but they must not be optional in CI, where the RLS
 * posture is the thing most worth knowing about.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.ts'],
    // Migrations run per file against a shared database; parallel files would race on
    // the drop-and-recreate.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      TZ: 'America/New_York',
    },
  },
});
