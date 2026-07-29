// Relative, not aliased: this module is executed directly by scripts/build-tokens.ts
// under plain Node, which does not resolve the `@/*` alias.
import { COLOUR_TOKENS, SCALE_TOKENS } from './tokens.ts';

export const GENERATED_HEADER = `/* GENERATED FILE — do not edit.
 * Source: src/design/tokens.ts   Regenerate: npm run tokens:build
 *
 * Colours live in TypeScript so the contrast suite can measure them. Editing this file
 * by hand would place a colour outside the reach of that test, so the build fails if
 * this file and its source have drifted.
 */`;

/** Deterministic: the same tokens always produce byte-identical CSS, so drift is detectable. */
export function renderTokenCss(): string {
  const colours = Object.entries(COLOUR_TOKENS)
    .map(([name, value]) => `  --colour-${name}: ${value};`)
    .join('\n');
  const scales = Object.entries(SCALE_TOKENS)
    .map(([name, value]) => `  --${name}: ${value};`)
    .join('\n');

  return `${GENERATED_HEADER}

:root {
${colours}

${scales}
}
`;
}
