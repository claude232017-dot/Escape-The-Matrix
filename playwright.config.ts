import { defineConfig, devices } from '@playwright/test';

// Bind and poll the SAME literal address. On a dual-stack runner "localhost" resolves
// to ::1 while the preview server listens on 127.0.0.1; the readiness check then never
// succeeds and the job dies at the timeout having run zero tests.
const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial on CI for stable timings; a fraction of the cores locally. Spelled as a value
  // rather than `undefined` because exactOptionalPropertyTypes rejects the latter.
  workers: process.env.CI ? 1 : '50%',
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for sandboxes that ship a Chromium whose build number does not
        // match this Playwright release and cannot download another. CI leaves it unset
        // and uses `playwright install`, so the pinned browser is what gets tested.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    // Serve the built artifact. Rebuilding inside the readiness budget is how this
    // times out on a cold cache.
    command: `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
