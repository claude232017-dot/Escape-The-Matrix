import { expect, test, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * Take your data, or be erased — in a real browser.
 *
 * This is the one screen in the app where a mis-wired control is **unrecoverable**. Everywhere
 * else a wrong button costs a bad row somebody can delete. Here it costs a man his month, with
 * no backup anyone can restore him from, because keeping one would mean deletion did not mean
 * deletion.
 *
 * So the assertions are mostly about the distance between a stray tap and destruction: the
 * delete control is behind an arming step, then behind typing his own address, and the button
 * stays disabled until it matches. The database checks it again regardless (§3.3) — this is
 * the courtesy layer, and the point of testing it is that the courtesy actually holds.
 */

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/harness/account${query}`);
  await expect(page.getByTestId('etm-account-harness-fixture')).toBeVisible();
}

test.describe('export', () => {
  test('is one press, because it is his own data', async ({ page }) => {
    // Deliberately not symmetrical with deletion. Asking twice for a copy of your own record
    // is theatre, and theatre trains people to click through the confirmation that matters.
    await open(page);
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeEnabled();
    await page.getByRole('button', { name: 'Export everything' }).click();
    await expect(page.getByTestId('export-done')).toContainText('escape-the-matrix-2026-08-01.json');
  });

  test('says what is in the file before he asks for it', async ({ page }) => {
    // Including the part he might not expect: a file of his own protocol detail and Bottom G
    // tactics is a sensitive object to have in a downloads folder, and he should know that
    // before it lands there rather than after.
    await open(page);
    const panel = page.getByTestId('account');
    await expect(panel).toContainText('protocol detail');
    await expect(panel).toContainText('Bottom G tactics');
  });
});

test.describe('deletion', () => {
  test('does not offer the confirmation until he asks for it', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('delete-confirm')).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByTestId('delete-confirm')).toBeVisible();
  });

  test('says it cannot be undone, and that there is no backup', async ({ page }) => {
    // A man deleting his account should not discover the irreversibility afterwards.
    await open(page);
    const panel = page.getByTestId('account');
    await expect(panel).toContainText('cannot be undone');
    await expect(panel).toContainText('no backup');
  });

  test('keeps the button disabled until the address matches exactly', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const erase = page.getByRole('button', { name: 'Erase everything' });

    await expect(erase).toBeDisabled();
    await page.getByLabel(/to confirm/).fill('member-a@example.co');
    await expect(erase, 'a near-miss address armed the button').toBeDisabled();
    await page.getByLabel(/to confirm/).fill('member-a@example.com');
    await expect(erase).toBeEnabled();
  });

  test('hands the database exactly what he typed', async ({ page }) => {
    // The database compares this against the address on the account. Sending anything else —
    // a trimmed value, a lower-cased one, the profile's email instead of the typed one — would
    // either refuse a deletion he meant or, far worse, succeed on something he did not type.
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByLabel(/to confirm/).fill('member-a@example.com');
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByTestId('delete-sent')).toHaveText('member-a@example.com');
  });

  test('lets him back out, and forgets what he typed', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page.getByLabel(/to confirm/).fill('member-a@example.com');
    await page.getByRole('button', { name: 'Keep my account' }).click();

    await expect(page.getByTestId('delete-confirm')).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByLabel(/to confirm/), 'the typed address survived a cancel').toHaveValue('');
  });

  test('shows the server’s refusal where he is looking', async ({ page }) => {
    await open(page, '?refused=1');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByTestId('delete-confirm').getByRole('alert')).toContainText(
      'not the address on this account',
    );
  });

  test('tells him what survives him', async ({ page }) => {
    // Playbooks the circle adopted stay, with his name off them. Better said here than
    // discovered by a man who expected total erasure and got something short of it.
    await open(page);
    await expect(page.getByTestId('account')).toContainText('Playbooks the circle adopted');
  });
});

test.describe('the account panel holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    expect(await unnamedControls(page.getByTestId('etm-account-harness-fixture'))).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    // It matters more here than anywhere: a cramped destructive button is how a mis-tap
    // becomes an erased account.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    expect(await smallTapTargets(page.getByTestId('etm-account-harness-fixture'))).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at ${String(width)}px`).toBe(false);
    }
  });

  test('renders with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await open(page);
    await page.getByRole('button', { name: 'Delete my account' }).click();
    expect(errors).toEqual([]);
  });

  test('does not offer deletion at all when the session carries no address', async ({ page }) => {
    // The regression. Supabase types `User.email` as `string | undefined` and the shell passes
    // `?? ''`, so this is reachable. The old guard read
    //
    //     typed.trim().toLowerCase() !== email.toLowerCase()
    //
    // which with an empty address is `'' !== ''` — **false** — so "Erase everything" armed
    // itself instantly with nothing typed, on the one control in this app that cannot be
    // undone. The database still refused it, and the whole distance between a stray tap and
    // destruction had silently gone to zero.
    await open(page, '?noemail=1');

    await expect(page.getByTestId('delete-unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Erase everything' })).toHaveCount(0);

    // Export is unaffected: it needs no address, and it is his data either way.
    await expect(page.getByRole('button', { name: 'Export everything' })).toBeEnabled();
  });
});
