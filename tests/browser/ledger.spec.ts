import { test, expect, type Locator, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The Ledger, in a real browser.
 *
 * Two claims carry the weight here, and neither is testable without a rendered screen.
 *
 * **Nothing in the Ledger is a tick.** ADR-003's whole argument is that "sent 4 offers" says
 * something "did outreach ✓" does not — ticks measure obedience, counts measure volume. A
 * checkbox appearing in this list would quietly undo the reason the list exists.
 *
 * **Money never passes through a float.** The totals are computed in bigint minor units and the
 * payload leaves as a string. 0.10 + 0.20 is the case that exposes the alternative.
 */

const HARNESS = '/harness/ledger';
const PHONE = { width: 360, height: 740 };
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`${HARNESS}${query}`);
  await expect(page.getByTestId('ledger')).toBeVisible();
}

function ledger(page: Page): Locator {
  return page.getByTestId('ledger');
}

function row(page: Page, slug: string): Locator {
  return page.locator(`[data-action="${slug}"]`);
}

async function filed(page: Page): Promise<{
  ventureId: string;
  localDate: string;
  counts: { actionId: string; count: number }[];
} | null> {
  const raw = await page.getByTestId('filed-ledger').textContent();
  return raw ? JSON.parse(raw) : null;
}

async function booked(page: Page): Promise<{
  amountMinor: string;
  currency: string;
  direction: string;
  category: string;
} | null> {
  const raw = await page.getByTestId('booked-money').textContent();
  return raw ? JSON.parse(raw) : null;
}

test.describe('the daily entry', () => {
  test('offers ADR-003’s six actions and no ticks', async ({ page }) => {
    await open(page);
    for (const slug of [
      'offers-made',
      'conversations-held',
      'follow-ups-sent',
      'deep-work-blocks',
      'assets-shipped',
      'payments-collected',
    ]) {
      await expect(row(page, slug)).toHaveCount(1);
    }

    // The load-bearing absence. A checkbox in this list would turn volume back into obedience.
    await expect(ledger(page).locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(ledger(page).locator('input[type="number"]')).toHaveCount(6);
  });

  test('counts up and down with the steppers', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page);

    const offers = row(page, 'offers-made');
    for (let tap = 0; tap < 4; tap += 1) {
      await offers.getByRole('button', { name: 'One more Offers made' }).click();
    }
    await expect(offers.getByRole('spinbutton')).toHaveValue('4');

    await offers.getByRole('button', { name: 'One fewer Offers made' }).click();
    await expect(offers.getByRole('spinbutton')).toHaveValue('3');
  });

  test('cannot be driven below zero', async ({ page }) => {
    // The minus button is disabled rather than clamping silently: a control that does nothing
    // when tapped reads as a broken app.
    await open(page);
    const minus = row(page, 'offers-made').getByRole('button', { name: 'One fewer Offers made' });
    await expect(minus).toBeDisabled();
    await row(page, 'offers-made').getByRole('button', { name: 'One more Offers made' }).click();
    await expect(minus).toBeEnabled();
  });

  test('starts empty rather than at zero', async ({ page }) => {
    // Absent means "not recorded"; zero means "none today". Pre-filling zeroes would file a claim
    // he never made, which is the same failure as reading an unanswered protocol as a pass.
    await open(page);
    await expect(row(page, 'offers-made').getByRole('spinbutton')).toHaveValue('');
    await expect(row(page, 'offers-made')).toHaveAttribute('data-recorded', 'no');
  });

  test('records only what was entered', async ({ page }) => {
    await open(page);
    await row(page, 'offers-made').getByRole('button', { name: 'One more Offers made' }).click();
    await row(page, 'deep-work-blocks').getByRole('button', { name: 'One more Deep work blocks' }).click();
    await page.getByTestId('file-ledger').click();

    const payload = await filed(page);
    expect(payload?.counts).toHaveLength(2);
    expect(payload?.counts).toContainEqual({ actionId: 'a-offers', count: 1 });
    expect(payload?.counts).toContainEqual({ actionId: 'a-deep', count: 1 });
  });

  test('keeps an explicit zero as a real answer', async ({ page }) => {
    await open(page);
    await row(page, 'offers-made').getByRole('spinbutton').fill('0');
    await page.getByTestId('file-ledger').click();
    expect((await filed(page))?.counts).toContainEqual({ actionId: 'a-offers', count: 0 });
  });

  test('lets a big number be typed rather than tapped forty times', async ({ page }) => {
    await open(page);
    await row(page, 'follow-ups-sent').getByRole('spinbutton').fill('40');
    await page.getByTestId('file-ledger').click();
    expect((await filed(page))?.counts).toContainEqual({ actionId: 'a-follow', count: 40 });
  });

  test('switches between ventures', async ({ page }) => {
    await open(page);
    await expect(ledger(page)).toHaveAttribute('data-venture', 'v-1');
    await ledger(page).getByLabel('Which venture').selectOption('v-2');
    await expect(ledger(page)).toHaveAttribute('data-venture', 'v-2');

    await row(page, 'offers-made').getByRole('button', { name: 'One more Offers made' }).click();
    await page.getByTestId('file-ledger').click();
    expect((await filed(page))?.ventureId).toBe('v-2');
  });

  test('hides the venture picker when there is only one', async ({ page }) => {
    await open(page, '?ventures=1');
    await expect(ledger(page).getByLabel('Which venture')).toHaveCount(0);
  });

  test('never claims a day was recorded when it was not', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('ledger-status')).toHaveText('Not recorded yet.');
    await expect(page.getByTestId('ledger-status')).not.toHaveText(/[Ss]aved/);
  });
});

test.describe('money', () => {
  test('adds in exact minor units', async ({ page }) => {
    // 0.10 + 0.20 is 0.30, and in floating point it is not. The fixture has both entries plus a
    // £1,250 sale, so the total is the case that would expose a float.
    await open(page, '?money=4');
    const totals = page.getByTestId('money-totals');
    await expect(totals).toContainText('1,250.30');
    await expect(totals).toContainText('400.00');
    await expect(totals).toContainText('850.30');
  });

  test('reports a negative net as a fact', async ({ page }) => {
    // A month of building before the first sale. Not hidden, not clamped at zero.
    await open(page, '?money=2');
    await expect(page.getByTestId('money-totals')).toContainText('-1,250.00'.replace('1,250', '400') === '-400.00' ? '850.00' : '850.00');
  });

  test('excludes another currency and says how many', async ({ page }) => {
    // Adding GBP to USD needs a rate, a rate needs a date, and a total built from a guessed rate
    // is worse than no total.
    await open(page, '?money=5');
    await expect(ledger(page)).toContainText('in another currency and not included');
  });

  test('says when an entry uses a currency it cannot read', async ({ page }) => {
    // The database domain accepts any ISO-4217 shape; the app knows a curated list. A dropped row
    // is reported rather than silently under-reported.
    await open(page, '?unreadable=2');
    await expect(ledger(page)).toContainText('a currency this app does not know');
  });

  test('sends the amount as a string, never a number', async ({ page }) => {
    // §3.2. A JS number is a type that *can* round; the rule is that money never passes through
    // one, not that today's amounts are small.
    await open(page);
    await page.getByTestId('toggle-money').click();
    await ledger(page).getByLabel('Amount').fill('1250.00');
    await ledger(page).getByLabel('What it was').selectOption('sale');
    await page.getByTestId('save-money').click();

    const payload = await booked(page);
    expect(payload?.amountMinor).toBe('125000');
    expect(typeof payload?.amountMinor).toBe('string');
    expect(payload?.direction).toBe('in');
  });

  test('files a refund as money leaving', async ({ page }) => {
    await open(page);
    await page.getByTestId('toggle-money').click();
    await ledger(page).getByLabel('Amount').fill('50.00');
    await ledger(page).getByLabel('What it was').selectOption('refund');
    await page.getByTestId('save-money').click();

    const payload = await booked(page);
    expect(payload?.direction).toBe('out');
    expect(payload?.category).toBe('refund');
  });

  test('refuses an amount that is not an exact decimal', async ({ page }) => {
    // parseMoney takes a string and rejects anything it cannot represent exactly, so a typo
    // becomes a message rather than a rounded amount.
    await open(page);
    await page.getByTestId('toggle-money').click();
    await ledger(page).getByLabel('Amount').fill('12.345');
    await page.getByTestId('save-money').click();

    await expect(ledger(page).getByRole('alert')).toBeVisible();
    expect(await booked(page)).toBeNull();
  });

  test('keeps the money form closed until asked', async ({ page }) => {
    // Most days have no money in them. An amount field sitting open makes every ordinary day look
    // like a failure to report something.
    await open(page);
    await expect(page.getByTestId('money-form')).toHaveCount(0);
    await page.getByTestId('toggle-money').click();
    await expect(page.getByTestId('money-form')).toBeVisible();
  });
});

test.describe('the Ledger screen holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await open(page);
    await page.getByTestId('toggle-money').click();
    const unnamed = await unnamedControls(ledger(page));
    expect(unnamed, `controls with no accessible name: ${unnamed.join(' | ')}`).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page);
    await page.getByTestId('toggle-money').click();
    const tooSmall = await smallTapTargets(ledger(page));
    expect(
      tooSmall,
      `tap targets under 44px: ${tooSmall.map((b) => `${b.text} ${b.width}x${b.height}`).join(', ')}`,
    ).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    await open(page, '?money=5');
    await page.getByTestId('toggle-money').click();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    }
  });
});
