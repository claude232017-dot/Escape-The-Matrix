import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Structural guardrails on the module graph.
 *
 * Import cycles do not announce themselves. They surface much later as an undefined
 * export at module-init time, in a file that has not been touched for weeks, and the
 * bundler's error names the victim rather than the cause. Checking the graph is cheap;
 * debugging the symptom is not.
 *
 * The layering rule is the same instinct applied to architecture: `lib` is shared
 * primitives and must not reach up into a feature, and features must not reach sideways
 * into each other's internals. Both are trivially easy to violate with an editor's
 * auto-import and near-impossible to unwind six months later.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const EXTENSIONS = ['.ts', '.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return EXTENSIONS.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Blank out comments, preserving offsets and line structure.
 *
 * `IMPORT_RE` matches `export … from '…'` with `[\s\S]*?` in the middle, so it happily spans
 * newlines — which real multi-line imports need. The cost is that an `export` on one line pairs
 * with the words `from "no attack"` in a comment thirty lines below, and reports a package
 * called `no attack`.
 *
 * That was invisible while every bare specifier was discarded as "not a file in src". It stops
 * being invisible the moment a rule cares about bare specifiers, which is what the allowlist
 * below does. `tests/unit/service-worker.test.ts` hit the same class of bug — its own
 * "NO skipWaiting() HERE" comment failed the check — and solved it the same way.
 *
 * Hand-scanned rather than regex-replaced because `'https://example.com'` contains `//` and a
 * naive strip would truncate the string it lives in.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    if (two === '/*') {
      while (i < source.length && source.slice(i, i + 2) !== '*/') {
        // Newlines are kept so line-anchored parts of the pattern still behave.
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }

    const char = source[i] ?? '';
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      out += char;
      i += 1;
      while (i < source.length) {
        const inner = source[i] ?? '';
        out += inner;
        i += 1;
        if (inner === '\\') {
          out += source[i] ?? '';
          i += 1;
          continue;
        }
        if (inner === quote) break;
      }
      continue;
    }

    out += char;
    i += 1;
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(source).matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (specifier) found.push(specifier);
  }
  return found;
}

/** Resolve a specifier to a file inside src, or null for a package or an asset. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null; // bare package
  }

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
    // `./tokens.ts` — allowImportingTsExtensions means the specifier may already carry it.
    ...EXTENSIONS.flatMap((ext) =>
      base.endsWith(ext) ? [base.slice(0, -ext.length) + ext] : [],
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const files = walk(SRC);

const graph = new Map<string, string[]>(
  files.map((file) => [
    file,
    importSpecifiers(readFileSync(file, 'utf8'))
      .map((specifier) => resolveSpecifier(file, specifier))
      .filter((target): target is string => target !== null),
  ]),
);

const rel = (file: string): string => relative(SRC, file).replaceAll('\\', '/');

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageOf(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] ?? '');
}

describe('module graph', () => {
  it('finds the source files it claims to be checking', () => {
    // Without this, a broken walk would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(5);
    expect(files.map(rel)).toContain('lib/date.ts');
    expect(files.map(rel)).toContain('features/auth/AuthProvider.tsx');
  });

  it('resolves the aliased and relative imports it finds', () => {
    const edges = [...graph.values()].flat();
    expect(edges.length).toBeGreaterThan(3);
    // Specific known edges, so a silently-failing resolver is caught. Without these, a
    // resolver that returned nothing would make every rule below vacuously true.
    const appImports = (graph.get(join(SRC, 'app/App.tsx')) ?? []).map(rel);
    expect(appImports).toContain('app/Motion.tsx');
    expect(appImports).toContain('features/auth/AuthProvider.tsx');
    expect(appImports).toContain('features/auth/components/AuthGate.tsx');

    // An aliased edge from a feature into lib, which is the direction that must stay legal.
    const validationImports = (graph.get(join(SRC, 'features/auth/validation.ts')) ?? []).map(rel);
    expect(validationImports).toContain('lib/email.ts');
    expect(validationImports).toContain('lib/field-validation.ts');

    // And a lib-internal edge: the profile field rules delegate the timezone question to the
    // date module, which is what keeps the client rule identical to the SQL one.
    const fieldImports = (graph.get(join(SRC, 'lib/field-validation.ts')) ?? []).map(rel);
    expect(fieldImports).toContain('lib/date.ts');
  });

  it('has no import cycles', () => {
    const state = new Map<string, 'visiting' | 'done'>();
    const cycles: string[][] = [];

    const visit = (node: string, stack: string[]): void => {
      const seen = state.get(node);
      if (seen === 'done') return;
      if (seen === 'visiting') {
        const start = stack.indexOf(node);
        cycles.push([...stack.slice(start), node].map(rel));
        return;
      }
      state.set(node, 'visiting');
      for (const next of graph.get(node) ?? []) visit(next, [...stack, node]);
      state.set(node, 'done');
    };

    for (const file of files) visit(file, []);

    expect(
      cycles.map((c) => c.join(' → ')),
      'import cycles found; these fail at module-init time in a file that looks innocent',
    ).toEqual([]);
  });

  it('keeps lib free of any dependency on a feature or the app', () => {
    // lib is the shared foundation: dates, money, contrast. The moment it imports a
    // feature it stops being reusable and starts being a second place where feature
    // logic lives.
    const violations: string[] = [];
    for (const [file, targets] of graph) {
      if (!rel(file).startsWith('lib/')) continue;
      for (const target of targets) {
        const to = rel(target);
        if (to.startsWith('features/') || to.startsWith('app/')) {
          violations.push(`${rel(file)} → ${to}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps features out of each other’s internals', () => {
    // Cross-feature imports are how a "small circle" app grows a knot nobody can
    // refactor. Shared things belong in lib, ui or design.
    const featureOf = (path: string): string | null => {
      const match = /^features\/([^/]+)\//.exec(path);
      return match?.[1] ?? null;
    };
    const violations: string[] = [];
    for (const [file, targets] of graph) {
      const from = featureOf(rel(file));
      if (!from) continue;
      for (const target of targets) {
        const to = featureOf(rel(target));
        if (to && to !== from) violations.push(`${rel(file)} → ${rel(target)}`);
      }
    }
    expect(
      violations,
      'cross-feature imports; promote the shared code to lib/ or ui/ instead',
    ).toEqual([]);
  });

  it('keeps screens rendered in more than one tab from owning their data', () => {
    // The regression this exists to prevent, in full: Radix unmounts an inactive `Tabs.Content`,
    // and ForgeScreen was mounted once under Today and once under Intel. Each instance loaded the
    // campaign itself, so every switch between the two tabs tore one down, built the other, and
    // re-ran nine sequential queries. It looked like a slow database and was a structural mistake.
    //
    // The invariant that fixes it: a screen mounted in more than one place does not fetch. Its
    // data is loaded once by the shell and handed down. Asserted on the import graph because a
    // reviewer cannot see "this component is mounted twice" from inside the component.
    // LedgerScreen joined the list when the venture insert moved out of it into
    // ledger-write.ts. It was the last piece of data access sitting inside a component, and it
    // was also the write that broke in a member's hands while every test passed — data access a
    // component owns is data access no test can call. Both screens now take data as a prop and
    // send through a named function.
    const noFetching = [
      'features/forge/components/ForgeScreen.tsx',
      'features/ledger/components/LedgerScreen.tsx',
      'features/week/components/WeekScreen.tsx',
      'features/command/components/CommanderScreen.tsx',
      'features/playbooks/components/PlaybookScreen.tsx',
    ];
    const violations: string[] = [];
    for (const file of noFetching) {
      const targets = graph.get(join(SRC, file)) ?? [];
      for (const target of targets) {
        if (rel(target) === 'lib/supabase.ts') {
          violations.push(`${file} loads its own data; lift it into a hook the shell calls once`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps design tokens free of imports entirely', () => {
    // The palette is data. If it grows a dependency it can no longer be read by the
    // generator under plain Node, and the contrast test loses its single source.
    const tokens = graph.get(join(SRC, 'design/tokens.ts'));
    expect(tokens).toEqual([]);
  });

  it('keeps a reporter SDK behind the egress boundary', () => {
    // §3.5: protocol detail must never reach a third party. `src/lib/egress.ts` is the door,
    // and this is what makes it the *only* one — a rule about the import graph rather than a
    // convention somebody remembers.
    //
    // The realistic failure is not malice. It is somebody adding Sentry on a Friday, calling
    // `Sentry.captureException(error)` in a component because that is what the docs show, and
    // sending a Postgres error whose `details` line reads "Failing row contains ('Ten sales
    // calls before Friday')". This fails that diff.
    //
    // Named packages only — see the allowlist below for the rule that actually holds. This one
    // survives because it produces the *specific* message somebody adding Sentry needs to read.
    const REPORTER_PACKAGES = [
      '@sentry',
      'sentry',
      'bugsnag',
      '@bugsnag',
      'rollbar',
      'logrocket',
      'posthog',
      'mixpanel',
      '@datadog',
      'datadog',
      'newrelic',
      '@amplitude',
      'amplitude',
      '@vercel/analytics',
      '@vercel/speed-insights',
    ];

    const allowed = join(SRC, 'lib/egress.ts');
    const violations: string[] = [];

    for (const file of files) {
      if (file === allowed) continue;
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        const bare = packageOf(specifier);
        if (REPORTER_PACKAGES.some((pkg) => bare === pkg || bare.startsWith(`${pkg}/`))) {
          violations.push(`${rel(file)} → ${specifier}`);
        }
      }
    }

    expect(
      violations,
      'a reporter SDK is imported outside lib/egress.ts; route it through report() instead',
    ).toEqual([]);
  });

  /**
   * Nothing third-party reaches the bundle without being declared here.
   *
   * ---------------------------------------------------------------------------
   * Why this replaced a denylist
   * ---------------------------------------------------------------------------
   * The rule above is a list of packages somebody thought of. `@vercel/analytics` was not on
   * it, so when Vercel's integration opened a PR adding `<Analytics />` to `App.tsx`, the
   * typecheck-lint-unit job went **green**. The only thing that went red was six browser tests
   * asserting no console errors — because the injected script 404s under the local preview
   * server. Had it been served with a 200 there, CI would have passed clean and this app would
   * be reporting every member's visit to a third party, from a product whose tables record
   * sexual-discipline compliance and substance use against named individuals.
   *
   * A denylist is wrong the moment somebody ships a package nobody predicted, and that is the
   * normal case rather than the exotic one — the diff arrived from a dashboard button, not from
   * a developer. So the question is inverted: every bare specifier in `src/` must be named
   * here, and an unrecognised one fails.
   *
   * Adding a dependency is then a deliberate line in this file rather than an `npm install`
   * nobody reviews. That is the point; it is meant to be a small amount of friction in exactly
   * the place where friction is worth paying for.
   */
  const ALLOWED_RUNTIME_PACKAGES = new Set([
    'react',
    'react-dom',
    'framer-motion',
    '@supabase/supabase-js',
    '@radix-ui/react-collapsible',
    '@radix-ui/react-radio-group',
    '@radix-ui/react-tabs',
    '@radix-ui/react-slot',
  ]);

  /**
   * Permitted in a `*.test.ts` and nowhere else.
   *
   * These never reach a member's browser, so they are not a §3.5 concern — but an import of
   * `vitest` from a component would ship a test framework in the bundle, so the separation is
   * enforced rather than assumed.
   */
  const ALLOWED_TEST_ONLY_PACKAGES = new Set(['vitest', 'fast-check']);

  const isTestFile = (file: string): boolean => /\.test\.tsx?$/.test(file);

  it('admits no undeclared third-party package into the bundle', () => {
    const violations: string[] = [];

    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.') || specifier.startsWith('@/')) continue;
        const bare = packageOf(specifier);

        // Node builtins are not bundled — Vite resolves them away or the file is test-only.
        if (bare.startsWith('node:')) continue;
        if (ALLOWED_RUNTIME_PACKAGES.has(bare)) continue;
        if (ALLOWED_TEST_ONLY_PACKAGES.has(bare) && isTestFile(file)) continue;

        violations.push(`${rel(file)} → ${specifier}`);
      }
    }

    expect(
      violations,
      'undeclared third-party import(s). Every package that reaches a member’s browser is ' +
        'named in ALLOWED_RUNTIME_PACKAGES in this file. If this dependency belongs here, add ' +
        'it — deliberately, having decided what it sends and to whom (§3.5).',
    ).toEqual([]);
  });

  it('names only packages that are actually installed', () => {
    // Otherwise the allowlist rots into a list of things nobody uses, and the next person
    // reading it cannot tell which entries are load-bearing.
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const installed = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]);

    const phantom = [...ALLOWED_RUNTIME_PACKAGES, ...ALLOWED_TEST_ONLY_PACKAGES].filter(
      (pkg) => !installed.has(pkg),
    );
    expect(phantom, `allowlisted but not in package.json: ${phantom.join(', ')}`).toEqual([]);
  });
});
