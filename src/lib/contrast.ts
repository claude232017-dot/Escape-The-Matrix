/**
 * WCAG 2.1 contrast maths.
 *
 * Exists so that the palette's legibility is a *measurement* with a test behind it,
 * rather than a designer's impression at the moment the colour was picked. A future
 * tweak to one hex value cannot quietly drop a pair below threshold: see
 * src/design/tokens.test.ts.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (≥24px, or ≥18.66px bold) and for UI component boundaries (1.4.11). */
export const AA_LARGE_TEXT = 3;

export function parseHex(hex: string): Rgb {
  const cleaned = hex.trim().replace(/^#/, '');
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    throw new Error(`Not a hex colour: ${JSON.stringify(hex)}`);
  }
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(value8Bit: number): number {
  const c = value8Bit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(colour: Rgb | string): number {
  const { r, g, b } = typeof colour === 'string' ? parseHex(colour) : colour;
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** Contrast ratio between two colours, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Rounded down to 2dp, so a reported ratio never overstates a borderline pair. */
export function roundRatio(ratio: number): number {
  return Math.floor(ratio * 100) / 100;
}
