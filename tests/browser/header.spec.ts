import { expect, test, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The campaign header, and the rain — in a real browser.
 *
 * The header renders only inside `SignedInShell`, behind a session, so until this file the most
 * seen element in the application had no test of any kind. It is the first thing a man reads
 * every morning and the only place the campaign is stated at all.
 *
 * The rain is tested here for what it must **not** do. The threshold screens are allowed to look
 * like something; past that door the design gets out of the way, because the SITREP has a filing
 * gate this suite measures at sixty seconds and moving glyphs behind a man deciding whether he
 * held his oath are not atmosphere, they are interference. `?rain=1` proves the harness *can*
 * mount it, which is what gives the "no application screen carries it" assertions their teeth.
 */

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/harness/header${query}`);
  await expect(page.getByTestId('etm-header-harness-fixture')).toBeVisible();
}

test.describe('the campaign day', () => {
  test('is the largest thing on the screen', async ({ page }) => {
    // Not decoration. "Where am I in this" is the question the header exists to answer, and a
    // figure set at caption size answers it only for somebody already looking for it.
    await open(page, '?day=22&length=30');

    const day = page.getByTestId('campaign-day');
    await expect(day).toHaveText('22');

    const sizes = await page.evaluate(() => {
      const all = [...document.querySelectorAll('body *')].filter(
        (el) => (el.textContent ?? '').trim().length > 0 && el.children.length === 0,
      );
      return all.map((el) => ({
        text: (el.textContent ?? '').trim().slice(0, 20),
        size: parseFloat(getComputedStyle(el).fontSize),
      }));
    });
    const largest = sizes.reduce((a, b) => (b.size > a.size ? b : a));
    expect(largest.text, `something is set larger than the day: ${JSON.stringify(largest)}`).toBe(
      '22',
    );
  });

  test('is set in the tabular face, so it does not jitter as the campaign runs', async ({
    page,
  }) => {
    // Day 1 → 11 → 22 changes width with proportional digits, and the whole header shifts under
    // it every morning. This is why `data-numeral` exists.
    await open(page);
    const numeric = await page
      .getByTestId('campaign-day')
      .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(numeric).toContain('tabular-nums');
  });

  test('says "Not enrolled" rather than day zero', async ({ page }) => {
    await open(page, '?day=none');
    await expect(page.getByText('Not enrolled')).toBeVisible();
    await expect(page.getByTestId('campaign-day')).toHaveCount(0);
    // No bar either: a progress bar for a campaign he has not joined is a bar at 0% of nothing.
    await expect(page.getByTestId('campaign-progress')).toHaveCount(0);
  });
});

test.describe('the progress rule', () => {
  test('draws one countable segment per day', async ({ page }) => {
    // The whole reason it is segmented rather than smooth: "eight days left" is a thing you can
    // see by counting, and 73% is a number nobody asked for.
    await open(page, '?day=22&length=30');
    const segments = page.getByTestId('campaign-progress').locator('span');
    await expect(segments).toHaveCount(30);
  });

  test('marks today, and marks it only once', async ({ page }) => {
    await open(page, '?day=22&length=30');
    const today = page.getByTestId('campaign-segment-today');
    await expect(today).toHaveCount(1);
    await expect(today).toHaveAttribute('data-day', '22');
  });

  test('announces the day to a screen reader without relying on the numeral', async ({ page }) => {
    // The large figure is a sibling, not a child, so the bar has to stand on its own.
    await open(page, '?day=22&length=30');
    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-label', 'Day 22 of 30');
    await expect(bar).toHaveAttribute('aria-valuenow', '22');
    await expect(bar).toHaveAttribute('aria-valuemax', '30');
  });

  test('does not run past the end of the campaign', async ({ page }) => {
    // Day 34 of a 30-day campaign is over, not 113% complete. It is reachable: the day is
    // computed from a start date and nothing stops the clock at thirty.
    await open(page, '?day=34&length=30');

    // No thirty-first segment, and the marker rests on the last day rather than falling off
    // the end — "you are at or past the finish", which is what a man on day 34 is.
    await expect(page.getByTestId('campaign-progress').locator('span')).toHaveCount(30);
    await expect(page.getByTestId('campaign-segment-today')).toHaveAttribute('data-day', '30');

    // The number itself is not clamped: he is on day 34 and the header says so.
    await expect(page.getByTestId('campaign-day')).toHaveText('34');

    // But `aria-valuenow` is, because a value above `aria-valuemax` is invalid ARIA and a
    // screen reader may announce anything or nothing for it.
    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '30');
    await expect(bar).toHaveAttribute('aria-valuemax', '30');
    await expect(bar, 'the true day vanished from the announcement').toHaveAttribute(
      'aria-label',
      'Day 34 of 30',
    );
  });

  test('falls back to a continuous bar when the days stop being countable', async ({ page }) => {
    // 365 segments on a 320px phone are a fifth of a pixel each. At that point the segments are
    // not conveying "count the days left", they are a texture — so it draws a bar and says so.
    await open(page, '?day=100&length=365');
    const segments = page.getByTestId('campaign-progress').locator('span');
    await expect(segments).not.toHaveCount(365);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '365');
  });

  test('survives a campaign length of zero', async ({ page }) => {
    // Straight from the campaigns table. Ungarded it divides by zero and renders NaN%.
    await open(page, '?day=1&length=0');
    await expect(page.getByTestId('campaign-header')).toBeVisible();
    const html = await page.getByTestId('campaign-progress').innerHTML();
    expect(html).not.toContain('NaN');
  });
});

test.describe('today’s state is never carried by colour alone', () => {
  for (const [query, expected] of [
    ['?filed=1', 'Today filed'],
    ['?filed=0', 'Today not filed'],
  ] as const) {
    test(`says "${expected}" in words`, async ({ page }) => {
      // A green dot and a red dot are the same dot to a man with a colour deficiency, and to
      // anyone reading a phone in sunlight.
      await open(page, query);
      await expect(page.getByTestId('filed-today')).toHaveText(expected);
    });
  }
});

test.describe('the rain', () => {
  test('is hidden from assistive technology entirely', async ({ page }) => {
    // It carries no information. A label would be read out to somebody who cannot see it and
    // would tell them nothing they could act on.
    await open(page, '?rain=1');
    await expect(page.getByTestId('matrix-rain')).toHaveAttribute('aria-hidden', 'true');
  });

  test('takes no clicks', async ({ page }) => {
    // It is fixed across the whole viewport. Without pointer-events:none it would swallow every
    // tap on the screen behind it.
    await open(page, '?rain=1');
    const events = await page
      .getByTestId('matrix-rain')
      .evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(events).toBe('none');
  });

  test('never appears behind an application screen', async ({ page }) => {
    // The rule, asserted where it matters rather than where it is convenient. The SITREP has a
    // measured sixty-second filing gate; animated glyphs behind that decision are hostile.
    for (const path of [
      '/harness/sitrep',
      '/harness/ledger',
      '/harness/week',
      '/harness/command',
      '/harness/playbooks',
      '/harness/account',
    ]) {
      await page.goto(path);
      await expect(
        page.getByTestId('matrix-rain'),
        `the rain followed him to ${path}`,
      ).toHaveCount(0);
    }
  });

  test('paints a still frame under reduced motion, rather than nothing', async ({ browser }) => {
    // §3.12 is usually read as "render nothing", which throws the whole look away for people
    // whose preference is about vestibular discomfort rather than taste. A frozen field costs
    // them nothing and keeps the room.
    //
    // The global CSS rule cannot reach this: a canvas loop is requestAnimationFrame, not a
    // transition, so honouring the preference has to be explicit and is therefore worth testing.
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await open(page, '?rain=1');

    const canvas = page.getByTestId('matrix-rain');
    const first = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

    // Long enough for many frames at ~24fps had the loop been running.
    await page.waitForTimeout(600);
    const second = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

    expect(second, 'the rain kept animating under prefers-reduced-motion').toBe(first);

    // An empty canvas is also identical to itself, so the equality above passes just as happily
    // on a rain that renders nothing — which is the exact outcome this test exists to rule out.
    //
    // Comparing against a *transparent* canvas is not enough either: `resize()` floods the
    // surface with the background colour before any glyph is drawn, so a canvas that painted no
    // rain at all still differs from blank. That version of this assertion passed a deliberate
    // mutation that deleted the drawing loop.
    //
    // So count glyph pixels directly. The accent green has a green channel of 0xDE against the
    // background's 0x07; nothing else is on this canvas, so a bright green pixel is a glyph.
    const glyphPixels = await canvas.evaluate((el) => {
      const context2d = (el as HTMLCanvasElement).getContext('2d');
      if (!context2d) return 0;
      const { width, height } = el as HTMLCanvasElement;
      const { data } = context2d.getImageData(0, 0, width, height);
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 1] ?? 0) > 100) lit += 1;
      }
      return lit;
    });
    expect(
      glyphPixels,
      'reduced motion painted no glyphs — the preference switched the look off rather than ' +
        'freezing it, which is the outcome the still frame exists to avoid',
    ).toBeGreaterThan(500);

    await context.close();
  });

  test('actually animates when motion is allowed', async ({ page }) => {
    // The other direction. Without this the reduced-motion test above would pass on a canvas
    // that never draws at all, which is the failure it exists to prevent.
    await open(page, '?rain=1');
    const canvas = page.getByTestId('matrix-rain');
    const first = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
    await page.waitForTimeout(600);
    const second = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());
    expect(second, 'the rain never moved').not.toBe(first);
  });
});

test.describe('the header holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await open(page);
    expect(await unnamedControls(page.getByTestId('etm-header-harness-fixture'))).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    expect(await smallTapTargets(page.getByTestId('etm-header-harness-fixture'))).toEqual([]);
  });

  for (const width of WIDTHS) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      // Thirty segments sharing a 288px content box is the specific risk here: without min-w-0
      // on each one, flex refuses to shrink them below their content size and the whole page
      // pans sideways.
      await page.setViewportSize({ width, height: 900 });
      await open(page, '?rain=1');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${String(width)}px`).toBe(false);
    });
  }

  test('renders with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await open(page, '?rain=1');
    expect(errors).toEqual([]);
  });
});
