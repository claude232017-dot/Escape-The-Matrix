import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, it, expect } from 'vitest';
import { contrastRatio, parseHex, roundRatio, AA_TEXT, AA_LARGE_TEXT } from '@/lib/contrast';
import {
  COLOUR_TOKENS,
  CONTRAST_PAIRS,
  DECORATIVE_ONLY_TOKENS,
  MINIMUM_RATIO,
  type ColourToken,
} from '@/design/tokens';
import { renderTokenCss } from '@/design/generate-css';

const colourOf = (token: ColourToken): string => COLOUR_TOKENS[token];

describe('contrast maths', () => {
  it('agrees with the WCAG reference values', () => {
    // Anchors from the specification itself, so a bug in the formula is caught before
    // it is used to bless a palette.
    expect(roundRatio(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
    expect(roundRatio(contrastRatio('#FFFFFF', '#FFFFFF'))).toBe(1);
    expect(roundRatio(contrastRatio('#777777', '#FFFFFF'))).toBe(4.47);
    expect(roundRatio(contrastRatio('#767676', '#FFFFFF'))).toBe(4.54);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#123456', '#ABCDEF')).toBeCloseTo(contrastRatio('#ABCDEF', '#123456'), 12);
  });

  it('parses hex in both lengths and rejects nonsense', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('0A0E13')).toEqual({ r: 10, g: 14, b: 19 });
    expect(() => parseHex('#12345')).toThrow();
    expect(() => parseHex('rebeccapurple')).toThrow();
  });
});

describe('the palette', () => {
  it.each(CONTRAST_PAIRS.map((p) => [`${p.fg} on ${p.bg} — ${p.usage}`, p] as const))(
    'meets its threshold: %s',
    (_label, pair) => {
      const ratio = contrastRatio(colourOf(pair.fg), colourOf(pair.bg));
      const minimum = MINIMUM_RATIO[pair.kind];
      expect(
        roundRatio(ratio),
        `${pair.fg} (${colourOf(pair.fg)}) on ${pair.bg} (${colourOf(pair.bg)}) measured ${roundRatio(ratio)}:1, needs ${minimum}:1 for ${pair.kind} — ${pair.usage}`,
      ).toBeGreaterThanOrEqual(minimum);
    },
  );

  it('holds every text pair to 4.5:1', () => {
    const textPairs = CONTRAST_PAIRS.filter((p) => p.kind === 'text');
    expect(textPairs.length).toBeGreaterThan(20);
    for (const pair of textPairs) {
      expect(contrastRatio(colourOf(pair.fg), colourOf(pair.bg))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('holds every control boundary to 3:1', () => {
    const nonText = CONTRAST_PAIRS.filter((p) => p.kind === 'non-text');
    expect(nonText.length).toBeGreaterThan(0);
    for (const pair of nonText) {
      expect(contrastRatio(colourOf(pair.fg), colourOf(pair.bg))).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT,
      );
    }
  });

  it('leaves no colour token unmeasured', () => {
    // The rule that makes the suite meaningful: adding a colour without declaring where
    // it is used fails here, so no colour can reach a screen without being measured.
    const used = new Set<string>();
    for (const pair of CONTRAST_PAIRS) {
      used.add(pair.fg);
      used.add(pair.bg);
    }
    const unmeasured = Object.keys(COLOUR_TOKENS).filter((token) => !used.has(token));
    expect(unmeasured, `colour tokens with no declared usage: ${unmeasured.join(', ')}`).toEqual([]);
  });

  it('does not let "decorative" become an escape hatch', () => {
    // Without this, any pair failing 3:1 could be relabelled decorative until it passed.
    const decorativeSet = new Set<ColourToken>(DECORATIVE_ONLY_TOKENS);
    for (const pair of CONTRAST_PAIRS) {
      if (pair.kind === 'decorative') {
        expect(
          decorativeSet.has(pair.fg),
          `${pair.fg} is used decoratively but is not declared in DECORATIVE_ONLY_TOKENS`,
        ).toBe(true);
      } else {
        expect(
          decorativeSet.has(pair.fg),
          `${pair.fg} is decorative-only and must not carry ${pair.kind} — ${pair.usage}`,
        ).toBe(false);
      }
    }
  });

  it('declares every token as a valid hex colour', () => {
    for (const [token, value] of Object.entries(COLOUR_TOKENS)) {
      expect(() => parseHex(value), `${token}: ${value}`).not.toThrow();
      expect(value, `${token} should be written as #RRGGBB`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('has no duplicate pair declarations', () => {
    const keys = CONTRAST_PAIRS.map((p) => `${p.fg}|${p.bg}|${p.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('generated stylesheet', () => {
  it('matches its source, so no colour can be edited out of the test’s reach', () => {
    const committed = readFileSync(
      fileURLToPath(new URL('../styles/tokens.css', import.meta.url)),
      'utf8',
    );
    expect(
      committed,
      'src/styles/tokens.css has drifted from src/design/tokens.ts — run `npm run tokens:build`',
    ).toBe(renderTokenCss());
  });

  it('emits every colour token as a custom property', () => {
    const css = renderTokenCss();
    for (const [token, value] of Object.entries(COLOUR_TOKENS)) {
      expect(css).toContain(`--colour-${token}: ${value};`);
    }
  });
});
