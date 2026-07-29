import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    env: {
      // Pinned to a NON-UTC zone on purpose. Running the date suite in UTC hides the
      // exact class of bug it exists to catch (see tests in src/lib/date.test.ts, which
      // additionally assert this pin is in effect and fail loudly if it is not).
      TZ: 'America/New_York',
    },
  },
});
