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

function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
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
});
