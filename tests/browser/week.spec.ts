import { expect, test, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The Week screen, in a real browser.
 *
 * What this suite is for that a unit test is not: the week's behaviour is almost entirely
 * *phase*-dependent, and each phase is a different screen. `weekPhase` is tested directly as a
 * function; what is only observable here is whether the screen actually changes — whether the
 * declare boxes disappear once he has declared, whether the settle panel appears when last week
 * is unanswered, and above all whether there is ever an edit control.
 *
 * The absence of an edit control is asserted as hard as anything positive, because it is the
 * feature: a commitment is immutable from the instant it is written (0008_commitments.sql), and
 * a screen that offered to change one would be promising something the database refuses.
 *
 * The harness takes `?today=` so a Sunday is reachable without waiting for one.
 */

const MONDAY = '2026-07-27';
const WEDNESDAY = '2026-07-29';
const SUNDAY = '2026-08-02';

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/harness/week?today=${MONDAY}${query}`);
  await expect(page.getByTestId('etm-week-harness-fixture')).toBeVisible();
}

const week = (page: Page) => page.getByTestId('week');

test.describe('declaring', () => {
  test('offers three slots and refuses an empty slate', async ({ page }) => {
    await open(page);
    await expect(week(page)).toContainText('Up to three');
    await expect(page.getByLabel(/Commitment 1/)).toBeVisible();
    await expect(page.getByLabel(/Commitment 3/)).toBeVisible();

    const declare = page.getByRole('button', { name: 'Declare the week' });
    await expect(declare).toBeDisabled();
    await expect(page.getByTestId('week-blockers')).toContainText('Write at least one commitment');
  });

  test('says what committing means before he does it', async ({ page }) => {
    // The copy is the mechanism. A man who does not know it is irreversible has not committed.
    await open(page);
    await expect(week(page)).toContainText('Declaring is committing');
    await expect(week(page)).toContainText('cannot be reworded');
  });

  test('enables the button once one commitment is written', async ({ page }) => {
    await open(page);
    await page.getByLabel(/Commitment 1/).fill('Ten sales calls');
    await expect(page.getByRole('button', { name: 'Declare the week' })).toBeEnabled();
    await expect(page.getByTestId('week-blockers')).toHaveCount(0);
  });

  test('names the duplicate rather than silently accepting it', async ({ page }) => {
    await open(page);
    await page.getByLabel(/Commitment 1/).fill('Ten sales calls');
    await page.getByLabel(/Commitment 2/).fill('ten sales calls');
    await expect(page.getByTestId('week-blockers')).toContainText(
      'Two of these are the same commitment',
    );
    await expect(page.getByRole('button', { name: 'Declare the week' })).toBeDisabled();
  });

  test('reports the declaration honestly rather than with a tick', async ({ page }) => {
    // §3.10. "Declared" is a claim about the server, and it is only made when it is true.
    await open(page);
    await expect(page.getByTestId('week-status')).toContainText('Not declared yet');
    await page.getByLabel(/Commitment 1/).fill('Ten sales calls');
    await page.getByRole('button', { name: 'Declare the week' }).click();
    await expect(page.getByTestId('week-status')).toContainText('on the server');
  });
});

test.describe('once declared', () => {
  test('shows the commitments and offers nothing to press mid-week', async ({ page }) => {
    // The honest mid-week screen. The work is the point; a screen that invents an interaction
    // here is inventing busywork, and busywork is what makes a man stop opening an app.
    await page.goto(`/harness/week?today=${WEDNESDAY}&declared=2`);
    await expect(week(page)).toContainText('Nothing to do here until Sunday');
    await expect(page.getByTestId('week-declared')).toContainText('Ten sales calls');
    await expect(page.getByRole('button', { name: 'Declare the week' })).toHaveCount(0);
  });

  test('never offers to edit a commitment', async ({ page }) => {
    // The rule the whole feature rests on, asserted as an absence. A commitment is immutable
    // from the moment it is written; a control that suggested otherwise would be lying about
    // what the database will accept.
    await page.goto(`/harness/week?today=${WEDNESDAY}&declared=3`);
    await expect(page.getByTestId('week-declared')).toBeVisible();
    for (const name of [/edit/i, /change/i, /reword/i, /update/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    // And no text input at all once the slate is full.
    await expect(page.locator('input[type="text"], input:not([type])')).toHaveCount(0);
  });

  test('offers a same-day withdrawal and takes it back', async ({ page }) => {
    // The typo escape hatch: same day only. Here `declaredOn` is the Monday and today is the
    // Monday, so it is available.
    await page.goto(`/harness/week?today=${MONDAY}&declared=2`);
    const withdraw = page.getByRole('button', { name: 'Withdraw' });
    await expect(withdraw).toHaveCount(2);
    await withdraw.first().click();
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(1);
  });

  test('withdraws nothing once the day has passed', async ({ page }) => {
    await page.goto(`/harness/week?today=${WEDNESDAY}&declared=2`);
    await expect(page.getByTestId('week-declared')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  });
});

test.describe('settling', () => {
  test('raises last week when it is unanswered', async ({ page }) => {
    await page.goto(`/harness/week?today=${MONDAY}&last=2`);
    const settle = page.getByTestId('settle');
    await expect(settle).toBeVisible();
    await expect(settle).toContainText('Last week is unanswered');
    await expect(settle).toContainText('2');
  });

  test('offers exactly two answers, and no third', async ({ page }) => {
    // "Hit or missed — there is no third answer." A "partly" button would make the whole
    // mechanism negotiable, which is the thing §8 is written to prevent.
    await page.goto(`/harness/week?today=${MONDAY}&last=1`);
    const settle = page.getByTestId('settle');
    await expect(settle.getByRole('button', { name: 'Hit' })).toBeVisible();
    await expect(settle.getByRole('button', { name: 'Missed' })).toBeVisible();
    await expect(settle.getByRole('button')).toHaveCount(2);
  });

  test('removes a commitment from the unanswered list once answered', async ({ page }) => {
    await page.goto(`/harness/week?today=${MONDAY}&last=2`);
    await page.getByTestId('settle').getByRole('button', { name: 'Hit' }).first().click();
    await expect(page.getByTestId('settle').getByRole('button', { name: 'Hit' })).toHaveCount(1);
  });

  test('does not raise last week when there is nothing owed', async ({ page }) => {
    await page.goto(`/harness/week?today=${WEDNESDAY}&declared=2`);
    await expect(page.getByTestId('settle')).toHaveCount(0);
  });

  test('says the week is over rather than prompting for more', async ({ page }) => {
    await page.goto(`/harness/week?today=${SUNDAY}&declared=2`);
    await expect(week(page)).toContainText('The week is over');
    await expect(page.getByRole('button', { name: 'Declare the week' })).toHaveCount(0);
  });

  test('states a week that passed with nothing declared, without nagging', async ({ page }) => {
    // Not a prompt to go back and declare — that week is gone and §8 forbids back-dating. A
    // fact, stated once.
    await page.goto(`/harness/week?today=${SUNDAY}`);
    await expect(week(page)).toContainText('No commitments were declared for this week');
    await expect(page.getByRole('button', { name: 'Declare the week' })).toHaveCount(0);
  });
});

test.describe('the circle', () => {
  test('shows what the others declared, grouped by man', async ({ page }) => {
    await open(page);
    const circle = page.getByTestId('circle-week');
    await expect(circle).toContainText('Marcus');
    await expect(circle).toContainText('Twenty cold emails');
    await expect(circle).toContainText('Dorian');
  });

  test('is not a leaderboard', async ({ page }) => {
    // §1 rules out the social feed, and a table sorted by hits is a feed wearing a different
    // shape. No totals, no ranking, no score anywhere on the screen.
    await open(page);
    const circle = page.getByTestId('circle-week');
    await expect(circle).toContainText('not a ranking');

    // "rank" is deliberately not in this list: the copy uses the word to deny it, and a
    // substring check that fails on its own disclaimer is checking spelling rather than
    // behaviour. These are words that could only appear if a score had actually been built.
    const text = (await circle.textContent())?.toLowerCase() ?? '';
    for (const word of ['leaderboard', 'score', 'points', 'streak', '%', 'out of']) {
      expect(text, `the circle panel says "${word}"`).not.toContain(word);
    }

    // The structural version of the same claim: no per-man tally is rendered anywhere. A
    // count beside a name is a league table whatever the surrounding copy says.
    const names = circle.locator('h3');
    await expect(names).toHaveCount(2);
    for (const heading of await names.allTextContents()) {
      expect(heading, 'a member heading carries a number').not.toMatch(/\d/);
    }
  });
});

test.describe('the Week screen holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await page.goto(`/harness/week?today=${MONDAY}&declared=1&last=2`);
    await expect(page.getByTestId('etm-week-harness-fixture')).toBeVisible();
    expect(await unnamedControls(page.getByTestId('etm-week-harness-fixture'))).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/harness/week?today=${MONDAY}&declared=1&last=2`);
    await expect(page.getByTestId('etm-week-harness-fixture')).toBeVisible();
    expect(await smallTapTargets(page.getByTestId('etm-week-harness-fixture'))).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/harness/week?today=${MONDAY}&declared=2&last=2`);
      await expect(page.getByTestId('etm-week-harness-fixture')).toBeVisible();
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
    await page.goto(`/harness/week?today=${MONDAY}&declared=1&last=2`);
    await expect(page.getByTestId('etm-week-harness-fixture')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
