import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { COLOUR_TOKENS } from '../../src/design/tokens.ts';

/**
 * Phase 0 browser gate.
 *
 * These assert the things a unit test cannot: real layout at real widths, real computed
 * styles, real focus. The unit suite proves the palette's contrast ratios; only a
 * browser can prove those colours actually arrive.
 */

/** Widths the layout must survive. Nothing may overflow horizontally at any of them. */
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  // The console text for a failed subresource is just "404 (Not Found)" with no URL,
  // which makes the failure unactionable. Record the request itself so the assertion
  // names the file that is missing.
  page.on('requestfailed', (request) =>
    errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  return errors;
}

test.describe('the shell', () => {
  test('renders with no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');

    // Wait for content, not for the header: a painted header does not mean the app
    // mounted. This asserts on a node React had to render.
    await expect(page.getByRole('heading', { name: 'Escape The Matrix' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Build status' })).toBeVisible();
    await expect(page.getByText('Phase 0')).toBeVisible();

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('exposes landmarks and a working skip link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    // The skip link is the first thing a keyboard user meets. It is hidden until
    // focused, so a passing "is visible" assertion has to come after tabbing to it.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await expect(page.locator('#main')).toBeVisible();
  });

  test('gives every interactive element an accessible name', async ({ page }) => {
    await page.goto('/');
    const interactive = page.locator(
      'a, button, input, select, textarea, [role="button"], [role="link"]',
    );
    // Wait for content rather than snapshotting a count: locator.count() does not retry
    // and would happily read 0 on a page that had not finished mounting.
    await expect(page.getByRole('heading', { name: 'Build status' })).toBeVisible();

    const names = await interactive.evaluateAll((elements) =>
      elements.map((el) => ({
        tag: el.tagName.toLowerCase(),
        name: (
          el.getAttribute('aria-label') ??
          el.textContent ??
          (el as HTMLInputElement).title ??
          ''
        ).trim(),
        html: el.outerHTML.slice(0, 120),
      })),
    );
    const unnamed = names.filter((n) => n.name === '');
    expect(unnamed, `elements with no accessible name: ${JSON.stringify(unnamed)}`).toEqual([]);
  });

  test('shows a visible focus ring on the focused control', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      const style = getComputedStyle(active);
      return { width: style.outlineWidth, style: style.outlineStyle, colour: style.outlineColor };
    });
    expect(outline).not.toBeNull();
    expect(outline?.style).not.toBe('none');
    expect(parseFloat(outline?.width ?? '0')).toBeGreaterThan(0);
  });
});

test.describe('layout', () => {
  for (const width of WIDTHS) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Build status' })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // Name the culprit rather than just failing: at 320px the offending node is
        // almost always one specific unbreakable string.
        widest: [...document.querySelectorAll('*')]
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            right: Math.round(el.getBoundingClientRect().right),
          }))
          .sort((a, b) => b.right - a.right)
          .slice(0, 3),
      }));

      expect(
        overflow.scrollWidth,
        `horizontal overflow at ${width}px; widest elements: ${JSON.stringify(overflow.widest)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }
});

test.describe('design tokens', () => {
  test('reach the browser with the values the contrast suite measured', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Build status' })).toBeVisible();

    const resolved = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(name).trim();
      return {
        surfaceVoid: read('--colour-surface-void'),
        textPrimary: read('--colour-text-primary'),
        accent: read('--colour-accent'),
        statusMed: read('--colour-status-med'),
      };
    });

    // Compared against the same constants the unit-level contrast test uses, so the
    // measured palette and the shipped palette cannot diverge.
    expect(resolved.surfaceVoid.toUpperCase()).toBe(COLOUR_TOKENS['surface-void']);
    expect(resolved.textPrimary.toUpperCase()).toBe(COLOUR_TOKENS['text-primary']);
    expect(resolved.accent.toUpperCase()).toBe(COLOUR_TOKENS.accent);
    expect(resolved.statusMed.toUpperCase()).toBe(COLOUR_TOKENS['status-med']);
  });

  test('renders numerals in the monospace face', async ({ page }) => {
    await page.goto('/');
    const family = await page
      .locator('[data-numeral]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(family).toContain('tabular-nums');
  });
});

test.describe('reduced motion', () => {
  test('is honoured globally', async ({ page }) => {
    // Emulated on the page rather than via `test.use({ reducedMotion })`: the fixture
    // sets a context option, and a mismatch between the Playwright release and the
    // Chromium build can leave it unapplied — which would make this test pass while
    // measuring nothing. page.emulateMedia goes straight to the browser and is
    // verified by the matchMedia assertion immediately below.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Build status' })).toBeVisible();

    const matches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(matches).toBe(true);

    // The global CSS rule must actually apply, not merely exist in the stylesheet.
    const duration = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity 500ms linear';
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });
    expect(parseFloat(duration)).toBeLessThan(0.05);
  });
});
