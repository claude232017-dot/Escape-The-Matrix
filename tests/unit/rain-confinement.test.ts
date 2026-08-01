import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The rain stays on the threshold.
 *
 * The rule, stated once: the sign-in, reset and disclosure screens are allowed to look like
 * something, because nothing is being decided there and no deadline is running. Past that door
 * the design gets out of the way. The SITREP has a filing gate this repository *measures* at
 * sixty seconds, and animated glyphs behind a man deciding whether he held his oath are not
 * atmosphere — they are interference with the one judgement the product exists to collect.
 *
 * ---------------------------------------------------------------------------
 * Why a static check and not another browser test
 * ---------------------------------------------------------------------------
 * tests/browser/header.spec.ts already loads every harness route and asserts the canvas is
 * absent. That covers each *screen*, and misses the case that would actually happen: somebody
 * adds `<MatrixRain />` to `SignedInShell`, one level above the screens, and it appears behind
 * all five tabs at once. No harness renders `SignedInShell` — it needs a real session — so no
 * browser test can see that regression.
 *
 * Reading the imports catches it wherever it is mounted, including places no suite can reach.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');

/**
 * The only modules permitted to mount the rain.
 *
 * `AuthShell` is the threshold itself. `HeaderHarness` mounts it behind `?rain=1` specifically
 * so the browser suite has a page that demonstrably *can* show the rain — without that, "no
 * application screen carries it" would be satisfied by a canvas that never rendered anywhere.
 */
const ALLOWED = new Set(['features/auth/components/AuthShell.tsx', 'app/harness/HeaderHarness.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : [];
  });
}

describe('the matrix rain', () => {
  const importers = sourceFiles(SRC)
    .filter((file) => /(^|[/\\])MatrixRain\.tsx$/.test(file) === false)
    .filter((file) => /\bMatrixRain\b/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).split('\\').join('/'));

  it('is mounted only on the threshold', () => {
    const trespassers = importers.filter((file) => !ALLOWED.has(file));
    expect(
      trespassers,
      `MatrixRain is referenced by ${trespassers.join(', ')}. The rain marks the door; it does ` +
        'not follow him inside. If a threshold screen genuinely needs it, add the file to ' +
        'ALLOWED here and say why.',
    ).toEqual([]);
  });

  it('is still mounted somewhere, so the rule is not vacuously satisfied', () => {
    // Deleting the component would make the assertion above pass forever.
    expect(importers).toContain('features/auth/components/AuthShell.tsx');
  });

  it('is never mounted by the signed-in shell or a feature screen', () => {
    // Stated separately from the allow-list because this is the failure with teeth: one line in
    // SignedInShell puts the rain behind all five tabs at once, and no browser suite can see it.
    for (const file of importers) {
      expect(file, `${file} mounts the rain inside the application`).not.toMatch(
        /SignedInShell|Screen\.tsx$/,
      );
    }
  });
});
