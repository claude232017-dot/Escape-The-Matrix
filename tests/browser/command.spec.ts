import { expect, test, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The Commander's View, in a real browser.
 *
 * Two things are only observable here. The first is the **refusal**: below five days on each
 * side the correlation must say so in words, and a screen that rendered `0.0 blocks` or an empty
 * card instead would be making the claim the engine spent its whole design avoiding. `finding()`
 * is unit-tested; that it reaches the page as a sentence is not.
 *
 * The second is the **absence of a leaderboard**. §1 rules out the social feed, and this is the
 * screen where one would otherwise grow: twelve men, comparable numbers, one table. The
 * assertions below are mostly about what is not on the page — no score, no percentage, no
 * ordering by output — and they are checked structurally rather than by reading the copy,
 * because a table sorted by days held is a league table whatever the heading says.
 */

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/harness/command${query}`);
  await expect(page.getByTestId('etm-command-harness-fixture')).toBeVisible();
}

test.describe('the correlation', () => {
  test('refuses to claim anything below the evidence threshold', async ({ page }) => {
    // The whole point of the engine, delivered as a sentence rather than a number. Three days
    // each side is not a finding, and the screen has to say that out loud.
    await open(page, '?days=3&broken=3');
    const claim = page.getByTestId('claim-blocks');
    await expect(claim).toContainText('Not enough yet');
    await expect(claim).toContainText('5');
    await expect(claim).toContainText('will not guess');
  });

  test('names the direction once there are five days on each side', async ({ page }) => {
    await open(page, '?days=6&broken=6');
    const claim = page.getByTestId('claim-blocks');
    await expect(claim).toContainText('4.0');
    await expect(claim).toContainText('1.0');
    await expect(claim).toContainText('held the line');
    await expect(claim).not.toContainText('Not enough yet');
  });

  test('needs the minimum on both sides, not in total', async ({ page }) => {
    // Twenty held days and one bad one is a large sample and no evidence about bad days.
    await open(page, '?days=20&broken=1');
    await expect(page.getByTestId('claim-blocks')).toContainText('Not enough yet');
  });

  test('shows how many days each average rests on', async ({ page }) => {
    // A mean with no denominator is a number a man cannot check. This is what makes the claim
    // auditable by hand, which is the only kind of trust worth having at this sample size.
    await open(page, '?days=6&broken=6');
    const claim = page.getByTestId('claim-blocks');
    await expect(claim).toContainText('6');
    await expect(claim).toContainText('Repeat days are in neither');
  });

  test('reports revenue in a table and never as a correlation', async ({ page }) => {
    // Four weeks is not a trend. Revenue appears as weekly rows; nothing on this screen
    // correlates it, and there is no coefficient anywhere.
    await open(page, '?days=12&broken=6');
    const panel = page.getByTestId('correlation');
    await expect(panel).toContainText('Revenue');
    const text = (await panel.textContent())?.toLowerCase() ?? '';
    for (const word of ['correlation coefficient', 'r =', 'r=', 'trend', 'forecast', 'predict']) {
      expect(text, `the correlation panel says "${word}"`).not.toContain(word);
    }
  });

  test('shows nothing at all before there is a single day', async ({ page }) => {
    // An empty correlation panel reads as a broken screen. It is absent instead.
    await open(page, '?days=0&broken=0');
    await expect(page.getByTestId('correlation')).toHaveCount(0);
  });
});

test.describe('needs attention', () => {
  test('says plainly when there is nothing to act on', async ({ page }) => {
    await open(page, '?days=6&broken=0');
    const panel = page.getByTestId('attention');
    await expect(panel).toContainText('Nothing to act on');
  });

  test('names the man and the specific reason', async ({ page }) => {
    // "Drifting" gives a mentor nothing to open a conversation with. "Silent 6 days" does.
    await open(page, '?days=6&broken=0&flag=1');
    const panel = page.getByTestId('attention');
    await expect(panel).toContainText('Marcus');
    await expect(panel).toContainText('silent 6 days');
    await expect(panel).toContainText('Dorian');
    await expect(panel).toContainText('2 commitments unanswered');
  });

  test('leaves out the men with nothing to flag', async ({ page }) => {
    // A list that includes everyone every day trains the reader to skim it.
    await open(page, '?days=6&broken=0&flag=1');
    const items = page.getByTestId('attention').locator('li');
    await expect(items).toHaveCount(2);
  });
});

test.describe('it is not a leaderboard', () => {
  test('orders the roster alphabetically, not by output', async ({ page }) => {
    // Any other order is a ranking. Asserted on the rendered order rather than on the copy,
    // because this is the one claim a comment cannot make true.
    await open(page, '?days=6&broken=0&flag=1');
    const names = await page.getByTestId('roster').locator('tbody tr td:first-child').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain('Marcus');
  });

  test('carries no score, percentage or rank column', async ({ page }) => {
    await open(page, '?days=6&broken=6&flag=1');
    const headers = await page.getByTestId('roster').locator('thead th').allTextContents();
    expect(headers.map((h) => h.toLowerCase())).toEqual([
      'member',
      'held',
      'reset',
      'last report',
    ]);

    const text = (await page.getByTestId('roster').textContent())?.toLowerCase() ?? '';
    for (const word of ['score', 'points', 'rank', '%', 'leader', 'top ', 'best', 'worst']) {
      expect(text, `the roster says "${word}"`).not.toContain(word);
    }
  });

  test('orders the attention list by need, putting the longest silence first', async ({ page }) => {
    // The distinction that keeps this from being a ranking: the man doing worst is at the top,
    // which is the opposite of what a league table does with him.
    await open(page, '?days=6&broken=0&flag=1');
    const first = page.getByTestId('attention').locator('li').first();
    await expect(first).toContainText('Marcus');
  });
});

test.describe('the Command screen holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await open(page, '?days=12&broken=6&flag=1');
    expect(await unnamedControls(page.getByTestId('etm-command-harness-fixture'))).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '?days=12&broken=6&flag=1');
    expect(await smallTapTargets(page.getByTestId('etm-command-harness-fixture'))).toEqual([]);
  });

  test('gives both tables an accessible caption', async ({ page }) => {
    // A table of numbers read aloud with no caption is a list of numbers. Both carry one.
    await open(page, '?days=12&broken=6');
    await expect(page.getByTestId('roster').locator('caption')).toContainText('Every member');
    await expect(page.getByTestId('correlation').locator('caption')).toContainText('Each week');
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    // §3.12. The two tables are the risk here — a wide table is the usual cause of a page that
    // scrolls sideways on a phone, which is why both sit in their own scroll container.
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '?days=12&broken=6&flag=1');
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
    await open(page, '?days=12&broken=6&flag=1');
    expect(errors).toEqual([]);
  });

  test('tells a member the table is not showing him protocol detail or money', async ({ page }) => {
    // The tab is not a permission — every member sees it, and what differs is what the database
    // returns. Saying so on the screen stops a member assuming he is seeing everything.
    await open(page, '?days=6&broken=0&mentor=0');
    await expect(page.getByTestId('roster')).toContainText('not in this table');
  });
});

test.describe('directives', () => {
  test('shows a man his instruction with nothing to reply to', async ({ page }) => {
    // §1 rules out chat, and the difference between a directive and a message is exactly the
    // absence asserted below. There is no reply box, no thread and no send control for him.
    await open(page, '?days=6&broken=0&mentor=0&directive=1');
    const panel = page.getByTestId('my-directive');
    await expect(panel).toContainText('Ten offers before Friday');
    await expect(panel).toContainText('nothing to reply to');

    await expect(page.getByTestId('directives').getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /reply|respond|send/i })).toHaveCount(0);
  });

  test('is absent for a member with no directive', async ({ page }) => {
    // Absent rather than an empty card. An empty card reads as something broken.
    await open(page, '?days=6&broken=0&mentor=0');
    await expect(page.getByTestId('directives')).toHaveCount(0);
  });

  test('lets the mentor write one, to somebody other than himself', async ({ page }) => {
    await open(page, '?days=6&broken=0');
    const panel = page.getByTestId('directives');
    await expect(panel).toBeVisible();

    // He is not in his own recipient list. The database refuses a self-directive too; this
    // simply never offers it.
    const options = await panel.getByRole('combobox').locator('option').allTextContents();
    expect(options).not.toContain('Aurelius');
    expect(options).toContain('Marcus');

    await expect(panel.getByRole('button', { name: 'Send it' })).toBeDisabled();
    await panel.getByLabel('The instruction').fill('Ten offers before Friday. No exceptions.');
    await expect(panel.getByRole('button', { name: 'Send it' })).toBeEnabled();
  });

  test('offers no way to edit one, only to withdraw', async ({ page }) => {
    // There is no UPDATE grant on the table at all, so an edit control would promise something
    // the database refuses outright.
    await open(page, '?days=6&broken=0&directive=1');
    const panel = page.getByTestId('directives');
    for (const name of [/edit/i, /amend/i, /reword/i]) {
      await expect(panel.getByRole('button', { name })).toHaveCount(0);
    }
  });
});
