import { test, expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The SITREP screen, in a real browser.
 *
 * The gate for this feature is a **measurement**: filing must take under sixty seconds, one-handed,
 * on a 360px screen. That is not something a unit test can establish, so it is done here — at
 * 360px, on day 22 when all eleven protocols are live, counting the taps and the wall time.
 *
 * These run against the harness build (`npm run build:harness`), which renders the presentational
 * component with fixture data and no network. tests/unit/harness-excluded.test.ts proves that
 * harness cannot exist in a production build; the pure rules behind the screen are covered by
 * src/features/forge/sitrep-draft.test.ts and the server side by tests/db/file-sitrep.test.ts.
 */

const HARNESS = '/harness/sitrep';
const PHONE = { width: 360, height: 740 };
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

/** Every protocol live. The worst case for the budget, so the one to measure. */
const DAY_ALL_LIVE = 22;
const PROTOCOLS_ON_DAY_22 = 11;

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  return errors;
}

async function openHarness(page: Page, day = DAY_ALL_LIVE): Promise<void> {
  await page.goto(`${HARNESS}?day=${day}`);
  await expect(page.getByTestId('sitrep')).toBeVisible();
}

function row(page: Page, slug: string): Locator {
  return page.locator(`[data-protocol="${slug}"]`);
}

/** The radio for one answer, found by its accessible name rather than its position. */
function answer(page: Page, slug: string, name: string | RegExp): Locator {
  return row(page, slug).getByRole('radio', { name });
}

async function filedPayload(page: Page): Promise<{
  finalStatus: string;
  resetKind: string | null;
  protocolsFailed: string[];
  results: { protocolId: string; status: string; medOptionId: string | null }[];
} | null> {
  const raw = await page.getByTestId('filed-payload').textContent();
  return raw ? JSON.parse(raw) : null;
}

test.describe('the SITREP screen', () => {
  test('files a complete day in under sixty seconds at 360px', async ({ page }) => {
    // The gate. One tap per protocol plus one to file — no confirmation dialog, no scroll-back, no
    // separate step to choose between Physical Forging's two MEDs, because those alternatives are
    // positions in the same control.
    await page.setViewportSize(PHONE);
    await openHarness(page);

    const rows = page.locator('[data-protocol]');
    await expect(rows).toHaveCount(PROTOCOLS_ON_DAY_22);

    const started = Date.now();
    let taps = 0;

    const slugs = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-protocol') ?? ''),
    );
    for (const slug of slugs) {
      // The first option in each row: "Done" for a duty, "Held" for a prohibition. A man having a
      // good day taps straight down the left-hand column.
      await row(page, slug).getByRole('radio').first().click();
      taps += 1;
    }

    await page.getByTestId('file-sitrep').click();
    taps += 1;

    await expect(page.getByTestId('queue-status')).toHaveText(/on the server/);
    const seconds = (Date.now() - started) / 1000;

    expect(taps, 'one tap per protocol plus one to file').toBe(PROTOCOLS_ON_DAY_22 + 1);
    expect(seconds, `filing took ${seconds.toFixed(1)}s`).toBeLessThan(60);

    const payload = await filedPayload(page);
    expect(payload?.finalStatus).toBe('complete');
    expect(payload?.results).toHaveLength(PROTOCOLS_ON_DAY_22);
  });

  test('groups the day into duties and prohibitions', async ({ page }) => {
    // Ungrouped, eleven protocols read as eleven unrelated items in an arbitrary order — the
    // per-row "duty" tag that used to carry this was doing a section header's job eleven times.
    await openHarness(page);
    await expect(page.getByRole('heading', { name: /Duties/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Prohibitions/ })).toBeVisible();

    const kinds = await page
      .locator('[data-protocol]')
      .evaluateAll((elements) =>
        elements.map((element) =>
          element.querySelector('[role="radio"]:last-child')?.textContent?.trim() ?? '',
        ),
      );
    // Every duty precedes every prohibition: "Missed" is a duty's fail, "Broke it" a prohibition's.
    const firstProhibition = kinds.indexOf('Broke it');
    expect(firstProhibition).toBeGreaterThan(0);
    expect(kinds.slice(firstProhibition).every((label) => label === 'Broke it')).toBe(true);
  });

  test('keeps the file control reachable without scrolling to the end', async ({ page }) => {
    // On a phone the list is more than twice the height of the screen. A submit button you have
    // to scroll to find is a submit button that gets found late, so the action bar is pinned to
    // the viewport and carries the day count and the progress with it.
    //
    // Measured from the box rather than with toBeInViewport(), which reports a ratio of zero for
    // this element — the pinned bar sets a backdrop-filter, and that creates a containing block
    // the intersection check does not resolve the way the rendered geometry does.
    await page.setViewportSize(PHONE);
    await openHarness(page);
    await expect(page.getByTestId('sitrep-progress')).toHaveText(/0 of 11 answered/);

    const onScreen = async () =>
      page.getByTestId('file-sitrep').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight && box.height > 0;
      });

    expect(await onScreen(), 'the file control is off screen on arrival').toBe(true);

    // Pinned for the length of the protocol list, which is its scope: past the end of the SITREP
    // he is in the debrief, and a file-the-day button hovering over a different form would be
    // pointing at the wrong task.
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(150);
    expect(await onScreen(), 'the file control scrolled away mid-list').toBe(true);
  });

  test('folds the artefacts on every row but the one he is about to answer', async ({ page }) => {
    // The rule that took the screen from 3,900px to something scannable. It has to move as he
    // fills the day in, or it is just "the first row is special".
    await openHarness(page);
    const code = 'I do not negotiate with the version of me that wants to quit.';
    await expect(row(page, 'morning-protocol').getByText(code)).toBeVisible();
    await expect(row(page, 'deep-work').getByText('Phone in another room', { exact: false })).toBeHidden();

    // Answer the rows above Deep Work and the reveal follows him down.
    for (const slug of ['morning-protocol', 'daily-sitrep', 'physical-forging']) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await expect(
      row(page, 'deep-work').getByText('Phone in another room', { exact: false }),
    ).toBeVisible();
  });

  test('offers only the protocols that are live on the day', async ({ page }) => {
    // Activation schedule, DOCTRINE §2.0. A protocol below its activation day cannot be failed and
    // must not be shown — offering one would judge a man against a rule that is not live.
    await openHarness(page, 1);
    await expect(page.locator('[data-protocol]')).toHaveCount(4);
    await expect(row(page, 'physical-forging')).toHaveCount(0);
    await expect(row(page, 'mindless-scrolling')).toHaveCount(0);

    await openHarness(page, 4);
    await expect(page.locator('[data-protocol]')).toHaveCount(6);
    await expect(row(page, 'physical-forging')).toHaveCount(1);
    await expect(row(page, 'junk-food')).toHaveCount(0);
  });

  test('shows the MED at the control, with his own Top G Code in it', async ({ page }) => {
    // The moment he reads the MED is the moment he is deciding whether to write the day off, so it
    // sits with the pass/fail control rather than behind a disclosure. The Morning Protocol MED
    // says "read the Top G Code aloud" — printing that without the Code is friction at exactly the
    // wrong moment.
    await page.setViewportSize(PHONE);
    await openHarness(page);

    const morning = row(page, 'morning-protocol');
    // Scoped to the paragraph: 'MED' is deliberately both the label on the text and the label
    // on the control, which is the point — the words and the button he taps say the same thing.
    await expect(morning.getByRole('paragraph').filter({ hasText: 'MED' })).toBeVisible();
    await expect(morning.getByText('read the Top G Code aloud', { exact: false })).toBeVisible();

    // Already open, unprompted, because this is the first unanswered row — the one he is about to
    // answer. The ten below it keep their artefacts folded, which is what took the screen from
    // 3,900px to something a man can scan.
    await expect(
      morning.getByText('I do not negotiate with the version of me that wants to quit.'),
    ).toBeVisible();

    // Deep Work's MED names the Fortress Protocol, so that is what its row offers — folded, one
    // tap away, and never the Top G Code, which its MED does not mention.
    const deepWork = row(page, 'deep-work');
    await expect(deepWork.getByText('Phone in another room', { exact: false })).toBeHidden();
    await deepWork.getByTestId('artefacts-toggle-deep-work').click();
    await expect(deepWork.getByText('Phone in another room', { exact: false })).toBeVisible();
    await expect(deepWork.getByText('Your Top G Code')).toHaveCount(0);
  });

  test('presents Physical Forging as a genuine either/or and records which he took', async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openHarness(page);

    const forging = row(page, 'physical-forging');
    // Four peer options, not three with a hidden sub-choice: done in full, either MED, or missed.
    await expect(forging.getByRole('radio')).toHaveCount(4);
    await expect(forging.getByText('100 push-ups and 200 bodyweight squats', { exact: false })).toBeVisible();
    await expect(forging.getByText('A 20-minute non-stop run or brisk walk', { exact: false })).toBeVisible();

    await answer(page, 'physical-forging', /Option B/).click();

    // Everything else held, so the day can be filed and the payload inspected.
    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      if (slug === 'physical-forging') continue;
      await row(page, slug).getByRole('radio').first().click();
    }
    await page.getByTestId('file-sitrep').click();

    const payload = await filedPayload(page);
    expect(payload?.results).toContainEqual({
      protocolId: 'id-physical-forging',
      status: 'med_pass',
      medOptionId: 'med-forging-b',
    });
    // A MED pass is a pass. The day is complete.
    expect(payload?.finalStatus).toBe('complete');
  });

  test('clears the MED option when he upgrades to a full pass', async ({ page }) => {
    // Mirror: the SQL constraint protocol_results_med_option_only_for_med_pass rejects a
    // med_option_id on a pass. Left set, every affected write would bounce — and it would claim he
    // did the minimum on a day he did the whole thing.
    await openHarness(page);
    await answer(page, 'physical-forging', /Option A/).click();
    await answer(page, 'physical-forging', /done in full/).click();

    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await page.getByTestId('file-sitrep').click();

    const payload = await filedPayload(page);
    expect(payload?.results).toContainEqual({
      protocolId: 'id-physical-forging',
      status: 'pass',
      medOptionId: null,
    });
  });

  test('counts a MED pass as a complete day and says so', async ({ page }) => {
    await openHarness(page);
    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await answer(page, 'morning-protocol', /minimum effective dose/).click();

    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-outcome', 'complete');
    await expect(verdict).toContainText('This is a complete day.');
    // "The only true failure is zero." A MED pass keeps the streak, and calling it anything less is
    // what makes a man stop using it.
    await expect(verdict).toContainText('That counts.');
  });

  test('calls one miss a tactical failure and names it', async ({ page }) => {
    await openHarness(page);
    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await answer(page, 'junk-food', /broke it/).click();

    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-outcome', 'repeat');
    await expect(verdict).toContainText('Tactical failure');
    await expect(verdict).toContainText('The day is lost and repeats');
    // Named, not counted: "two protocols failed" is not something he can act on.
    await expect(verdict).toContainText('junk-food');
  });

  test('reports a reset as a fact with its consequence, not as a verdict', async ({ page }) => {
    // Framed as a judgement, a reset becomes something to avoid filing — and an unfiled reset is a
    // hole in the only dataset this product exists to build.
    await openHarness(page);
    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await answer(page, 'sexual-discipline', /broke it/).click();

    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-outcome', 'reset');
    await expect(verdict).toContainText('An act of treason under the oath.');
    await expect(verdict).toContainText('returns to Day 1 tomorrow');
    // The load-bearing sentence: nothing is destroyed. ADR-002.
    await expect(verdict).toContainText('stays in the record');

    await page.getByTestId('file-sitrep').click();
    const payload = await filedPayload(page);
    expect(payload?.finalStatus).toBe('reset');
    expect(payload?.resetKind).toBe('treason');
    expect(payload?.protocolsFailed).toEqual(['sexual-discipline']);
  });

  test('treats three misses as a zero day', async ({ page }) => {
    await openHarness(page);
    for (const slug of await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''))) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await answer(page, 'junk-food', /broke it/).click();
    await answer(page, 'video-games', /broke it/).click();

    await expect(page.getByTestId('verdict')).toHaveAttribute('data-outcome', 'repeat');

    await answer(page, 'binge-watching', /broke it/).click();
    const verdict = page.getByTestId('verdict');
    await expect(verdict).toHaveAttribute('data-outcome', 'reset');
    await expect(verdict).toContainText('A zero day.');

    await page.getByTestId('file-sitrep').click();
    expect((await filedPayload(page))?.resetKind).toBe('zero_day');
  });

  test('discloses which protocols the circle never sees itemised', async ({ page }) => {
    // §3.5. Sensitive protocols default to aggregate-only, and saying so where he answers is the
    // difference between a policy and a disclosure. Compressed from two lines of prose to a tag,
    // because repeated verbatim on two rows it was boilerplate the eye learned to skip — but the
    // full sentence stays reachable, which is what the title assertion pins.
    await openHarness(page);
    for (const slug of ['sexual-discipline', 'alcohol-and-drugs']) {
      const tag = row(page, slug).getByText('Status only');
      await expect(tag).toBeVisible();
      await expect(tag).toHaveAttribute(
        'title',
        /circle sees this only in your day's status, never itemised/i,
      );
    }
    await expect(row(page, 'video-games').getByText('Status only')).toHaveCount(0);
  });

  test('will not file an incomplete day', async ({ page }) => {
    // Silence is not a pass. Filing ten of eleven would record the eleventh as held.
    await openHarness(page);
    await expect(page.getByTestId('file-sitrep')).toBeDisabled();
    await expect(page.getByTestId('verdict')).toHaveAttribute('data-outcome', 'incomplete');
    await expect(page.getByTestId('verdict')).toContainText('11 protocols still need an answer.');

    const slugs = await page
      .locator('[data-protocol]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-protocol') ?? ''));
    for (const slug of slugs.slice(0, -1)) {
      await row(page, slug).getByRole('radio').first().click();
    }
    await expect(page.getByTestId('file-sitrep')).toBeDisabled();
    await expect(page.getByTestId('verdict')).toContainText('1 protocol still needs an answer.');

    await row(page, slugs.at(-1) as string)
      .getByRole('radio')
      .first()
      .click();
    await expect(page.getByTestId('file-sitrep')).toBeEnabled();
  });

  test('never claims a report was saved when it was not', async ({ page }) => {
    // §3.10. "Saved" and a green tick are both lies for something still on the device, and a man
    // who believes his SITREP is filed does not file it again.
    await openHarness(page);
    const status = page.getByTestId('queue-status');
    await expect(status).toHaveText(/Nothing waiting to send\./);
    await expect(status).not.toHaveText(/[Ss]aved/);
    await expect(page.getByText('✓')).toHaveCount(0);
  });

  test('is operable with the keyboard alone', async ({ page }) => {
    await openHarness(page, 1);
    const done = answer(page, 'morning-protocol', /done in full/);
    const med = answer(page, 'morning-protocol', /minimum effective dose/);
    const missed = answer(page, 'morning-protocol', /missed/);

    // Entered with a click and then driven by keys — how a phone user actually corrects an
    // answer, and a hard barrier: waiting for `toBeChecked` guarantees React has committed the
    // roving-focus state before the first arrow, which Playwright would otherwise press inside a
    // window a human cannot hit.
    await done.click();
    await expect(done).toBeChecked();

    // What is asserted is the *outcome* a keyboard user gets, not which internal path produced
    // it. Radix's roving focus sometimes selects an option as the arrow lands on it and sometimes
    // only moves focus — a race in its own implementation between the keyup that clears its
    // arrow-key flag and React's focus handler. Both paths reach the same place, so pinning one
    // of them would be pinning a coin toss, and an earlier version of this test did exactly that
    // and failed roughly one run in three.
    await page.keyboard.press('ArrowRight');
    await expect(med).toBeFocused();
    await page.keyboard.press('Space');
    await expect(med).toBeChecked();
    await expect(done).not.toBeChecked();

    await page.keyboard.press('ArrowRight');
    await expect(missed).toBeFocused();
    await page.keyboard.press('Space');
    await expect(missed).toBeChecked();

    // Exactly one answer, whichever path got there. A row that ends up with two checked options
    // would send two results for one protocol, and the day would evaluate against whichever the
    // database happened to keep.
    await expect(
      row(page, 'morning-protocol').locator('[role="radio"][aria-checked="true"]'),
    ).toHaveCount(1);

    // Each row is a single tab stop rather than one per option, so eleven protocols are eleven
    // stops rather than thirty-eight.
    await page.keyboard.press('Tab');
    await expect(row(page, 'daily-sitrep').getByRole('radio').first()).toBeFocused();
  });

  test('gives every control an accessible name', async ({ page }) => {
    await openHarness(page);
    // Scoped to the SITREP section. The harness renders the debrief below it, and that screen has
    // its own spec — a failure here should name this screen and no other.
    const unnamed = await unnamedControls(page.getByTestId('sitrep'));
    expect(unnamed, `controls with no accessible name: ${unnamed.join(' | ')}`).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openHarness(page);
    const tooSmall = await smallTapTargets(page.getByTestId('sitrep'));
    expect(
      tooSmall,
      `tap targets under 44px: ${tooSmall.map((b) => `${b.text} ${b.width}x${b.height}`).join(', ')}`,
    ).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    await openHarness(page);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('renders with no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.setViewportSize(PHONE);
    await openHarness(page);
    await row(page, 'morning-protocol').getByRole('radio').first().click();
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('respects prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHarness(page);
    await expect(page.getByTestId('sitrep')).toBeVisible();
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll('*')].filter((element) => {
        const style = getComputedStyle(element);
        const duration = Number.parseFloat(style.animationDuration) || 0;
        return style.animationName !== 'none' && duration > 0;
      }).length,
    );
    expect(animated).toBe(0);
  });

  test('does not expose the harness anywhere but its own path', async ({ page }) => {
    // Even in the harness build. The route is one exact path, so a mistyped or guessed URL lands on
    // the application, which requires a session.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('sitrep')).toHaveCount(0);

    await page.goto('/harness');
    await expect(page.getByTestId('sitrep')).toHaveCount(0);
  });
});
