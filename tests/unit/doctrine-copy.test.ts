import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two copy rules from DOCTRINE §1, held by a test rather than by good intentions.
 *
 * **The saboteur is named Bottom G and nothing else.** Not "your enemy", not "the voice", not
 * "your lower self". The vocabulary is doing real work — it externalises failure, which is the
 * entire mechanism the debrief schema exists to serve. "I am lazy" is shame and shame is
 * paralysis; "the Bottom G attacked at 15:00 using tiredness" is intelligence and intelligence
 * has a counter-measure. Softening it back to "the enemy" quietly removes the thing that works,
 * and it happens one well-meaning edit at a time. It had already happened twice — in the Intel
 * pattern panel and in the debrief form — before this test existed.
 *
 * **The source material's rainbow flag tag is not carried across.** It aims at a group of people
 * rather than at the behaviour, it does no work the word "saboteur" is not already doing, and it
 * is the kind of thing that becomes a screenshot. That is a rule about what ships, so it is
 * checked against what ships.
 *
 * Comments are stripped before checking: this is about what a member reads, and the source is
 * allowed to discuss the words it is avoiding — including this file.
 */

const COMPONENT_ROOTS = ['src'];

/** Every .ts/.tsx under src that is not itself a test. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Remove `//`, block comments and JSX comments.
 *
 * Deliberately crude — it will also blank a `//` inside a string literal, which for this test is
 * the safe direction to be wrong in: it can hide a violation from a URL, never invent one.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function shippedCopy(): { file: string; text: string }[] {
  return COMPONENT_ROOTS.flatMap(sourceFiles).map((file) => ({
    file,
    text: stripComments(readFileSync(file, 'utf8')),
  }));
}

describe('DOCTRINE §1 copy rules', () => {
  it('never softens the Bottom G into "the enemy"', () => {
    // Word-boundary match on the noun, so "enemy" inside an identifier or an import path is not
    // a hit and a genuine sentence always is.
    const offenders = shippedCopy()
      .filter(({ text }) => /\benem(y|ies)\b/i.test(text))
      .map(({ file, text }) => {
        const line = text.split('\n').findIndex((l) => /\benem(y|ies)\b/i.test(l)) + 1;
        return `${file}:${line}`;
      });

    expect(
      offenders,
      'DOCTRINE §1: the saboteur figure is named Bottom G and nothing else',
    ).toEqual([]);
  });

  it('carries no rainbow flag tag into anything that ships', () => {
    // The emoji itself and its two encodings — the ZWJ sequence and the bare components — rather
    // than the words "rainbow flag", which the source is allowed to use to explain the rule.
    const FLAGS = ['\u{1F3F3}️‍\u{1F308}', '\u{1F3F3}‍\u{1F308}', '\u{1F308}'];

    const offenders = shippedCopy()
      .filter(({ text }) => FLAGS.some((flag) => text.includes(flag)))
      .map(({ file }) => file);

    expect(
      offenders,
      'DOCTRINE §1: the source material tags the saboteur with a rainbow flag; it is not carried across',
    ).toEqual([]);
  });

  it('still uses the Bottom G vocabulary somewhere, so the rules above cannot pass by deletion', () => {
    // Both checks above are satisfied by an interface that never names the figure at all. §1 asks
    // for the opposite: the vocabulary is used, not translated and not dropped.
    const naming = shippedCopy().filter(({ text }) => /Bottom G/.test(text));
    expect(naming.length).toBeGreaterThanOrEqual(3);
    expect(naming.map((n) => n.file)).toContain(
      'src/features/forge/components/AttackPatternPanel.tsx',
    );
  });
});
