import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The test harness must not exist in a production build.
 *
 * `src/app/harness/SitrepHarness.tsx` renders an application screen with **no authentication**.
 * That is fine in a build made for the browser suite and is a hole in a build served to the
 * internet. The gate is `import.meta.env.VITE_TEST_HARNESS === '1'`, which Vite inlines as a
 * literal so Rollup can eliminate the branch and the dynamic import with it.
 *
 * That reasoning is exactly the kind that stays true until a refactor makes the import static, or
 * until someone adds the variable to `.env`. So this builds in the default mode and looks.
 *
 * The build is real and takes a few seconds. That is the price of the claim being evidence rather
 * than an argument.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Two independent traces of the harness, checked against different kinds of file.
 *
 * `MARKER` is a fixture string that exists only inside the harness module, so it appears in a
 * **sourcemap** exactly when that module was bundled — which is the strongest signal available and
 * the one that caught a static-import refactor in practice.
 *
 * `ROUTE` is the path App.tsx compares against. It is checked only against executable assets,
 * because App.tsx's own source is in the sourcemap either way: the map carries the whole original
 * file including a branch Rollup deleted. Asserting on it there would fail permanently and teach
 * whoever hit it to delete the test.
 */
const MARKERS = [
  'etm-sitrep-harness-fixture',
  'etm-ledger-harness-fixture',
  'etm-week-harness-fixture',
];
const ROUTES = ['/harness/sitrep', '/harness/ledger', '/harness/week'];
const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html'];

let outDir: string | null = null;

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe('the test harness', () => {
  it('is absent from a default-mode build', () => {
    outDir = mkdtempSync(join(tmpdir(), 'etm-prod-build-'));

    execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Explicitly cleared: an inherited value would make this test pass by testing the wrong
        // build. The assertion about the .env files below covers the committed side.
        VITE_TEST_HARNESS: '',
      },
    });

    const built = filesUnder(outDir);
    expect(built.length, 'the build produced no files').toBeGreaterThan(0);

    const offenders = built.flatMap((file) => {
      const name = relative(outDir as string, file);
      const content = readFileSync(file, 'utf8');
      const isCode = CODE_EXTENSIONS.some((extension) => file.endsWith(extension));

      const found: string[] = [];
      // The fixture string reaching any emitted file — including a sourcemap — means the harness
      // module was bundled.
      for (const marker of MARKERS) {
        if (content.includes(marker)) found.push(`${name} contains ${marker}`);
      }
      for (const route of ROUTES) {
        if (isCode && content.includes(route)) found.push(`${name} still routes to ${route}`);
      }
      return found;
    });
    expect(offenders, 'the harness survived into a production build').toEqual([]);
  }, 180_000);

  it('is not switched on by any committed env file', () => {
    // `--mode harness` loads .env.harness and nothing else loads it. Putting the variable in .env
    // or .env.production would switch the harness on for every build, and the tree-shaking test
    // above would still pass because it clears the variable itself.
    const loadedByDefaultBuilds = ['.env', '.env.production', '.env.example'];
    for (const name of loadedByDefaultBuilds) {
      const path = join(ROOT, name);
      if (!existsSync(path)) continue;
      expect(
        readFileSync(path, 'utf8'),
        `${name} must not set VITE_TEST_HARNESS — it is loaded by a normal build`,
      ).not.toMatch(/^\s*VITE_TEST_HARNESS\s*=/m);
    }
  });

  it('is switched on by .env.harness, which only --mode harness loads', () => {
    // The other half: if this file stopped setting the variable, the browser suite would silently
    // test a build with no harness in it and every SITREP assertion would fail confusingly.
    const path = join(ROOT, '.env.harness');
    expect(existsSync(path), '.env.harness is missing — npm run build:harness would be a no-op').toBe(
      true,
    );
    expect(readFileSync(path, 'utf8')).toMatch(/^\s*VITE_TEST_HARNESS\s*=\s*1\s*$/m);
  });
});
