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
 * `MARKERS` are fixture strings that exist only inside a harness module, so one appears in a
 * **sourcemap** exactly when that module was bundled — which is the strongest signal available and
 * the one that caught a static-import refactor in practice.
 *
 * `ROUTES` are the paths App.tsx compares against. They are checked only against executable
 * assets, because App.tsx's own source is in the sourcemap either way: the map carries the whole
 * original file including a branch Rollup deleted. Asserting on it there would fail permanently
 * and teach whoever hit it to delete the test.
 *
 * ---------------------------------------------------------------------------
 * Both lists are read off the source, never typed out here
 * ---------------------------------------------------------------------------
 * They were hand-maintained until a seventh harness was added and neither list knew about it.
 * A missing entry does not fail anything — it silently narrows the search, so the test goes on
 * passing while the thing it exists to catch walks straight past. That is the worst failure mode
 * a guard can have, and it is invisible precisely when someone is adding new unauthenticated
 * screens.
 *
 * So the markers are scraped from `src/app/harness/*.tsx` and the routes from App.tsx, and the
 * count is asserted against the number of harness files. Adding a harness now extends the guard
 * automatically; forgetting the marker constant fails loudly instead of quietly.
 */
const HARNESS_DIR = join(ROOT, 'src/app/harness');

const HARNESS_FILES = readdirSync(HARNESS_DIR).filter((name) => name.endsWith('.tsx'));

const MARKERS = HARNESS_FILES.map((name) => {
  const source = readFileSync(join(HARNESS_DIR, name), 'utf8');
  const marker = /const HARNESS_MARKER = '([^']+)'/.exec(source)?.[1];
  if (!marker) {
    throw new Error(
      `${name} declares no HARNESS_MARKER constant. Every harness needs one: it is the string ` +
        'this test greps a production build for, and without it the module can be bundled ' +
        'into a public build with nothing noticing.',
    );
  }
  return marker;
});

const ROUTES = [
  ...new Set(
    [...readFileSync(join(ROOT, 'src/app/App.tsx'), 'utf8').matchAll(/'(\/harness\/[a-z]+)'/g)].map(
      (match) => match[1] ?? '',
    ),
  ),
];

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
  it('knows about every harness on disk', () => {
    // The scrape above is only as good as what it found. If a glob change or a renamed constant
    // ever returns an empty set, every assertion below passes by searching for nothing.
    expect(HARNESS_FILES.length, 'no harness files found — the scrape is broken').toBeGreaterThan(0);
    expect(MARKERS.length).toBe(HARNESS_FILES.length);
    expect(
      ROUTES.length,
      `${String(HARNESS_FILES.length)} harness files but ${String(ROUTES.length)} routes in ` +
        'App.tsx — a harness with no route is dead code, and a route with no harness is a 404 ' +
        'that renders the real app',
    ).toBe(HARNESS_FILES.length);
  });

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
