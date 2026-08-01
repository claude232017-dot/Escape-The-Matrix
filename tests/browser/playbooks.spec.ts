import { expect, test, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * Playbooks, in a real browser.
 *
 * This is the most social-feed-shaped screen in the product, so most of this file asserts
 * **absences**: no vote control, no comment box, no author byline, no adoption ranking. Those
 * are checked here rather than only in the schema because a feed can be built entirely in the
 * front end out of columns that were never meant for it.
 *
 * The one positive claim that matters as much: the `personal` verdict has to reach the page
 * saying *the system did not travel*, not *you failed*. That sentence is the entire reason the
 * feature is worth building, and it only exists rendered.
 */

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/harness/playbooks${query}`);
  await expect(page.getByTestId('etm-playbook-harness-fixture')).toBeVisible();
}

test.describe('the verdict', () => {
  test('says a system travels when it held for most who answered', async ({ page }) => {
    await open(page);
    const row = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await expect(row.getByTestId('verdict')).toContainText('Held for');
    await expect(row.getByTestId('verdict')).toContainText('4');
  });

  test('takes the blame off the man when a system does not travel', async ({ page }) => {
    // The sentence the whole feature exists for. "It did not work for you" is a fact about the
    // system; "you failed" would be the app having an opinion about his character.
    await open(page);
    const row = page.getByTestId('playbook').filter({ hasText: 'Cold shower' });
    await expect(row.getByTestId('verdict')).toContainText('Did not work for');
    await expect(row.getByTestId('verdict')).toContainText('that is the system, not you');
  });

  test('refuses a verdict under three answers', async ({ page }) => {
    // Three men out of twelve is as much evidence as this feature will ever get. Below it the
    // screen says so rather than guessing.
    await open(page);
    const row = page.getByTestId('playbook').filter({ hasText: 'Phone in another room' });
    await expect(row.getByTestId('verdict')).toContainText('have answered');
    await expect(row.getByTestId('verdict')).toContainText('3');
    await expect(row.getByTestId('verdict')).not.toContainText('Held for');
  });

  test('does not count pending adoptions against a playbook', async ({ page }) => {
    // Otherwise a system looks worse the more people are currently trying it.
    await open(page);
    const row = page.getByTestId('playbook').filter({ hasText: 'Phone in another room' });
    await expect(row.getByTestId('verdict')).toContainText('1 of 4');
  });
});

test.describe('adopting and answering', () => {
  test('offers a man one way in and two ways out', async ({ page }) => {
    await open(page, '?adopted=pending');
    const row = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await expect(row.getByRole('button', { name: 'It held' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'It did not' })).toBeVisible();
    // No third answer. A "partly" would make the whole thing negotiable, exactly as it would
    // for a commitment.
    await expect(row.getByRole('button', { name: /partly|sort of|maybe/i })).toHaveCount(0);
  });

  test('shows his own answer once given, and stops offering the buttons', async ({ page }) => {
    await open(page, '?adopted=pending');
    const row = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await row.getByRole('button', { name: 'It did not' }).click();
    await expect(row.getByTestId('my-answer')).toContainText('did not work for you');
    await expect(row.getByRole('button', { name: 'It held' })).toHaveCount(0);
  });

  test('does not offer to adopt something he has already tried', async ({ page }) => {
    // Mirror: applications_one_per_man. Without it a man could move a transfer rate alone.
    await open(page, '?adopted=answered');
    const row = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await expect(row.getByRole('button', { name: 'Adopt it' })).toHaveCount(0);
  });

  test('offers abandon only while the answer is still owed', async ({ page }) => {
    await open(page, '?adopted=pending');
    const row = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await expect(row.getByRole('button', { name: 'Abandon' })).toBeVisible();

    await open(page, '?adopted=answered');
    const settled = page.getByTestId('playbook').filter({ hasText: 'Clothes out the night before' });
    await expect(settled.getByRole('button', { name: 'Abandon' })).toHaveCount(0);
  });

  test('does not offer to adopt a retired playbook', async ({ page }) => {
    await open(page);
    const row = page.getByTestId('playbook').filter({ hasText: 'Six alarms' });
    await expect(row).toContainText('retired');
    await expect(row.getByRole('button', { name: 'Adopt it' })).toHaveCount(0);
  });
});

test.describe('it is not a feed', () => {
  test('has no vote, like, comment or share control anywhere', async ({ page }) => {
    // §1 rules out the social feed. A front end can build one out of columns that were never
    // meant for it, which is why this is asserted on the page and not only on the schema.
    await open(page, '?mentor=1&adopted=pending');
    for (const name of [/vote/i, /like/i, /upvote/i, /comment/i, /share/i, /follow/i, /star/i]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    const text = (await page.getByTestId('playbooks').textContent())?.toLowerCase() ?? '';
    for (const word of ['votes', 'likes', 'popular', 'trending', 'top rated', 'most adopted']) {
      expect(text, `the catalogue says "${word}"`).not.toContain(word);
    }
  });

  test('names no author on any playbook', async ({ page }) => {
    // Nothing in the schema aggregates by author, and nothing here reveals one. A byline turns
    // the catalogue into a reputation board one glance at a time.
    await open(page);
    const text = (await page.getByTestId('playbooks').textContent()) ?? '';
    for (const marker of ['by ', 'From ', 'Author', 'submitted']) {
      expect(text, `a playbook carries "${marker}"`).not.toContain(marker);
    }
  });

  test('is not ordered by adoption or by verdict', async ({ page }) => {
    // The fixture is deliberately worst-case for this: the most-adopted and best-performing
    // playbook is first in source order anyway, so the assertion is that the *untested* one
    // keeps its place rather than sinking below the successful ones.
    await open(page);
    const titles = await page.getByTestId('playbook').locator('h3').allTextContents();
    expect(titles[0]).toContain('Clothes out the night before');
    expect(titles[1]).toContain('Cold shower');
    expect(titles[2]).toContain('Phone in another room');
    // Retired last, and still present — a man who adopted it has it in his record.
    expect(titles[3]).toContain('Six alarms');
  });
});

test.describe('promoting', () => {
  test('is offered to the mentor only', async ({ page }) => {
    await open(page, '?mentor=1');
    await expect(page.getByTestId('promote')).toBeVisible();

    await open(page);
    await expect(page.getByTestId('promote')).toHaveCount(0);
  });

  test('says the words cannot be changed before he commits to them', async ({ page }) => {
    await open(page, '?mentor=1');
    await expect(page.getByTestId('promote')).toContainText('cannot be changed');
  });

  test('needs both a name and the system', async ({ page }) => {
    await open(page, '?mentor=1');
    const promote = page.getByTestId('promote');
    await expect(promote.getByRole('button', { name: 'Promote it' })).toBeDisabled();
    await promote.getByLabel('What to call it').fill('Clothes out the night before');
    await expect(promote.getByRole('button', { name: 'Promote it' })).toBeDisabled();
    await promote.getByLabel('The system itself').fill('Lay the kit out before bed');
    await expect(promote.getByRole('button', { name: 'Promote it' })).toBeEnabled();
  });
});

test.describe('the Playbooks screen holds up', () => {
  test('explains itself when the catalogue is empty', async ({ page }) => {
    await open(page, '?empty=1');
    await expect(page.getByTestId('etm-playbook-harness-fixture')).toContainText(
      'a system one man used that worked',
    );
  });

  test('gives every control an accessible name', async ({ page }) => {
    await open(page, '?mentor=1&adopted=pending');
    expect(await unnamedControls(page.getByTestId('etm-playbook-harness-fixture'))).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, '?mentor=1&adopted=pending');
    expect(await smallTapTargets(page.getByTestId('etm-playbook-harness-fixture'))).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, '?mentor=1&adopted=pending');
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
    await open(page, '?mentor=1&adopted=pending');
    expect(errors).toEqual([]);
  });
});
