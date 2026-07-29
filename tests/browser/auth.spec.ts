import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import { COLOUR_TOKENS } from '../../src/design/tokens.ts';

/**
 * Phase 1 browser gate.
 *
 * The most valuable test here is the recovery hold: it drives a real browser to a real
 * recovery URL and asserts the reset screen is what renders, from the first paint. No unit
 * test can establish that, because the failure is a *render* — the dashboard appearing for a
 * few hundred milliseconds while the auth library exchanges a token.
 *
 * These run without Supabase credentials. That is deliberate: signed-out and recovery are
 * exactly the states that must be correct before any backend is reachable.
 */

const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  return errors;
}

test.describe('signed out', () => {
  test('renders sign-in with no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('says plainly that it is invite only', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Invite only.', { exact: false })).toBeVisible();
  });

  test('shows no application content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Build status' })).toHaveCount(0);
  });

  test('gives every interactive element an accessible name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    const unnamed = await page
      .locator('a, button, input, select, textarea, [role="button"], [role="link"]')
      .evaluateAll((elements) =>
        elements
          .map((el) => {
            // An <input> has no textContent, so its name comes from the associated <label>.
            // Computing it any other way would report every field as unnamed.
            const labels = (el as HTMLInputElement).labels;
            const fromLabel = labels && labels.length > 0 ? (labels[0]?.textContent ?? '') : '';
            const name = (
              el.getAttribute('aria-label') ??
              (fromLabel || el.textContent) ??
              ''
            ).trim();
            return { name, html: el.outerHTML.slice(0, 100) };
          })
          .filter((entry) => entry.name === ''),
      );
    expect(unnamed, `elements with no accessible name: ${JSON.stringify(unnamed)}`).toEqual([]);
  });

  test('labels every field with a real label, not a placeholder', async ({ page }) => {
    // A placeholder-as-label disappears the moment someone types, which is exactly when
    // they most need to know what the field was.
    await page.goto('/');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('shows a visible focus ring on the first tab stop', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return null;
      const style = getComputedStyle(active);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline?.style).not.toBe('none');
    expect(parseFloat(outline?.width ?? '0')).toBeGreaterThan(0);
  });

  test('reaches every control by keyboard alone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    const reached = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const description = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const labels = (el as HTMLInputElement).labels;
        const label = labels && labels.length > 0 ? labels[0]?.textContent : null;
        return `${el.tagName.toLowerCase()}:${(label ?? el.textContent ?? '').trim().slice(0, 30)}`;
      });
      if (description) reached.add(description);
    }
    expect([...reached].join(' | ')).toContain('Email');
    expect([...reached].join(' | ')).toContain('Password');
    expect([...reached].join(' | ')).toMatch(/Sign in/i);
  });
});

test.describe('password recovery — the §3.7 gate', () => {
  test('a recovery URL lands on the reset screen', async ({ page }) => {
    await page.goto('/?mode=reset');
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  });

  test('a recovery URL cannot be used to browse the app', async ({ page }) => {
    // The success criterion, stated directly. The recovery link produces a real session, so
    // anything reachable from here would be reachable by whoever can read the email.
    await page.goto('/?mode=reset');
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Build status' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);

    // No navigation out of the screen: not a link, not a skip link, nothing.
    await expect(page.getByRole('link')).toHaveCount(0);

    // The only two controls are the ones this screen owns. Asserting the whole set rather
    // than picking off names, because "no way out" is a property of the complete list —
    // and note that "Cancel and sign out" IS permitted: abandoning a reset must be
    // possible, and it ends the session rather than navigating past the screen.
    const buttons = await page.getByRole('button').allInnerTexts();
    expect(buttons.sort()).toEqual(['Cancel and sign out', 'Set password']);
  });

  test('never flashes another screen before settling on reset', async ({ page }) => {
    // The bug this exists to catch: the reset view appearing only AFTER the auth library
    // finishes, with the dashboard or sign-in form visible in the meantime. Sampling from
    // the very first frames is the only way to see it.
    const seen: string[] = [];
    await page.goto('/?mode=reset', { waitUntil: 'commit' });
    for (let i = 0; i < 25; i += 1) {
      const heading = await page
        .evaluate(() => document.querySelector('h1')?.textContent ?? '')
        .catch(() => '');
      if (heading) seen.push(heading);
      await page.waitForTimeout(20);
    }
    expect(seen.length, 'never observed a heading at all').toBeGreaterThan(0);
    const wrong = seen.filter((heading) => heading !== 'Set a new password');
    expect(wrong, `saw other screens before reset settled: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  test('detects recovery from the hash fragment too', async ({ page }) => {
    // Supabase's implicit flow puts type=recovery in the fragment. Missing it would drop a
    // recovery link onto the dashboard.
    await page.goto('/#access_token=fake-token&type=recovery&expires_in=3600');
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  });

  test('an ordinary URL does not trigger the reset screen', async ({ page }) => {
    // The other direction: a false positive would strand people who simply visited the app.
    await page.goto('/?mode=signin');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('requires a long password and matching confirmation', async ({ page }) => {
    await page.goto('/?mode=reset');
    // Scoped to the field's own description rather than getByRole('alert'): on a build with
    // no Supabase keys there is a second alert on screen, and matching either one would let
    // this pass while validating nothing.
    const fieldError = page
      .locator('[aria-invalid="true"]')
      .first()
      .and(page.locator('input'));

    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('At least 12 characters', { exact: false })).toBeVisible();
    await expect(fieldError).toHaveCount(1);

    await page.getByLabel('New password', { exact: true }).fill('a-long-enough-password');
    await page.getByLabel('Confirm password').fill('a-different-password');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  });
});

test.describe('layout', () => {
  for (const width of WIDTHS) {
    test(`does not overflow horizontally at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
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
        `horizontal overflow at ${width}px; widest: ${JSON.stringify(overflow.widest)}`,
      ).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }

  // Both signed-out screens: the setup form has the most controls and is where a small
  // target is likeliest to appear. Filing a SITREP one-handed on a 360px screen is a Phase 2
  // requirement, and the controls have to be hittable before that is worth timing.
  for (const [label, path] of [
    ['sign-in', '/'],
    ['first-time setup', '/?join=1'],
  ] as const) {
    test(`keeps tap targets at least 44px tall on a phone — ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path);
      const targets = await page
        .locator('button, input, select')
        .evaluateAll((els) =>
          els.map((el) => ({
            height: Math.round(el.getBoundingClientRect().height),
            html: el.outerHTML.slice(0, 80),
          })),
        );
      expect(targets.length).toBeGreaterThan(0);
      const tooSmall = targets.filter((t) => t.height < 44);
      expect(tooSmall, `targets under 44px: ${JSON.stringify(tooSmall)}`).toEqual([]);
    });
  }
});

test.describe('design tokens', () => {
  test('reach the browser with the values the contrast suite measured', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
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
    expect(resolved.surfaceVoid.toUpperCase()).toBe(COLOUR_TOKENS['surface-void']);
    expect(resolved.textPrimary.toUpperCase()).toBe(COLOUR_TOKENS['text-primary']);
    expect(resolved.accent.toUpperCase()).toBe(COLOUR_TOKENS.accent);
    expect(resolved.statusMed.toUpperCase()).toBe(COLOUR_TOKENS['status-med']);
  });
});

test.describe('reduced motion', () => {
  test('is honoured globally', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);

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

test.describe('first-time setup', () => {
  test('is reachable from sign-in and back again', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up your account' }).click();
    await expect(page.getByRole('heading', { name: 'First time here' })).toBeVisible();

    await page.getByRole('button', { name: 'I already have an account' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('opens directly from a join link, so an invited man is not left guessing', async ({
    page,
  }) => {
    await page.goto('/?join=1');
    await expect(page.getByRole('heading', { name: 'First time here' })).toBeVisible();
  });

  test('tells him to use the exact invited address', async ({ page }) => {
    // The single most common failure: signing up with a different address than the one
    // invited, and getting an error that names nothing.
    await page.goto('/?join=1');
    await expect(page.getByText('exact email address', { exact: false })).toBeVisible();
  });

  test('captures the timezone at signup, with the offset shown', async ({ page }) => {
    // Captured here because it is the last moment before it starts mattering: every day
    // count, week boundary and SITREP deadline is measured against it.
    await page.goto('/?join=1');
    const zone = page.getByLabel('Timezone');
    await expect(zone).toBeVisible();

    const options = await zone.locator('option').count();
    expect(options, 'expected a full timezone list').toBeGreaterThan(40);

    // The offset is shown so the choice can be checked against a clock on the wall.
    await expect(zone.locator('option', { hasText: /UTC/ }).first()).toBeAttached();
    const labels = await zone.locator('option').allInnerTexts();
    expect(labels.some((label) => /\([+-]\d{2}:\d{2}\)/.test(label))).toBe(true);
  });

  test('warns that a guessed timezone may be wrong', async ({ page }) => {
    await page.goto('/?join=1');
    await expect(page.getByText('holiday time', { exact: false })).toBeVisible();
  });

  test('validates before it ever reaches the database', async ({ page }) => {
    await page.goto('/?join=1');
    const submit = page.getByRole('button', { name: 'Create my account' });

    await submit.click();
    await expect(page.getByText('An email address is required.')).toBeVisible();

    await page.getByLabel('Email').fill('not-an-email');
    await submit.click();
    await expect(page.getByText('That does not look like an email address.')).toBeVisible();

    await page.getByLabel('Email').fill('friend@example.com');
    await submit.click();
    await expect(page.getByText('A name is required.')).toBeVisible();

    await page.getByLabel('Name').fill('A Friend');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await submit.click();
    await expect(page.getByText('At least 12 characters', { exact: false })).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
    await page.getByLabel('Confirm password').fill('something-else-entirely');
    await submit.click();
    await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  });

  test('gives every control an accessible name', async ({ page }) => {
    await page.goto('/?join=1');
    await expect(page.getByRole('heading', { name: 'First time here' })).toBeVisible();
    const unnamed = await page
      .locator('a, button, input, select, textarea')
      .evaluateAll((elements) =>
        elements
          .map((el) => {
            const labels = (el as HTMLInputElement).labels;
            const fromLabel = labels && labels.length > 0 ? (labels[0]?.textContent ?? '') : '';
            return {
              name: (el.getAttribute('aria-label') ?? (fromLabel || el.textContent) ?? '').trim(),
              html: el.outerHTML.slice(0, 90),
            };
          })
          .filter((entry) => entry.name === ''),
      );
    expect(unnamed, `unnamed controls: ${JSON.stringify(unnamed)}`).toEqual([]);
  });

  test('does not overflow at 320px, where the form is tallest', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/?join=1');
    await expect(page.getByRole('heading', { name: 'First time here' })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test('a join link does not override a recovery link', async ({ page }) => {
    // Both are read from the URL at first paint. Recovery must win, or a crafted link could
    // route someone holding a recovery session into a form instead of the reset screen.
    await page.goto('/?join=1&mode=reset');
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'First time here' })).toHaveCount(0);
  });
});
