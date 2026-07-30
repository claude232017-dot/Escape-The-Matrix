import { test, expect, type Locator, type Page } from '@playwright/test';
import { smallTapTargets, unnamedControls } from './a11y.ts';

/**
 * The debrief, in a real browser.
 *
 * Two claims are worth the most here, and neither is testable without a rendered screen.
 *
 * **The app does not claim a pattern it does not have.** Below the minimum, or with attacks spread
 * across the day, it says so rather than naming a window. A man who acts on "your enemy attacks at
 * 15:00", finds nothing, and learns the app invents things will not believe the real finding when
 * it eventually arrives.
 *
 * **The wording never blames him.** DOCTRINE §6.2 is explicit that self-blame produces shame and
 * no intelligence. The field labels are the instruction — he reads them daily, and nothing else in
 * the app teaches him how to think about a loss.
 */

const HARNESS = '/harness/sitrep';
const PHONE = { width: 360, height: 740 };
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920];

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`${HARNESS}?day=22${query}`);
  await expect(page.getByTestId('debrief')).toBeVisible();
}

function debrief(page: Page): Locator {
  return page.getByTestId('debrief');
}

async function filedDebrief(page: Page): Promise<{
  attacked: boolean;
  systemUsed: string | null;
  victory: string | null;
  outcome: string | null;
  occurredAtHour: number | null;
  triggerKind: string | null;
  propaganda: string | null;
} | null> {
  const raw = await page.getByTestId('filed-debrief').textContent();
  return raw ? JSON.parse(raw) : null;
}

/** The shortest complete debrief: a quiet day, nothing else answered. */
async function quietDay(page: Page): Promise<void> {
  await debrief(page).getByRole('radio', { name: 'The Bottom G did not attack' }).click();
}

test.describe('the debrief', () => {
  test('files a quiet day without demanding an insight', async ({ page }) => {
    // Requiring a victory every single day is how a man starts inventing them, and invented
    // intelligence is worse than none.
    await open(page);
    await quietDay(page);
    await expect(page.getByTestId('file-debrief')).toBeEnabled();
    await page.getByTestId('file-debrief').click();

    const payload = await filedDebrief(page);
    expect(payload).toMatchObject({
      attacked: false,
      systemUsed: null,
      victory: null,
      outcome: null,
      occurredAtHour: null,
      triggerKind: null,
    });
  });

  test('will not file until the attack question is answered', async ({ page }) => {
    // Silence and "no attack" are different facts. A schema that cannot tell them apart loses the
    // denominator for every rate the feature promises.
    await open(page);
    await expect(page.getByTestId('file-debrief')).toBeDisabled();
    await expect(page.getByTestId('debrief-blockers')).toContainText(
      'Say whether the Bottom G attacked today.',
    );
  });

  test('asks for the hour, trigger and outcome once he says he was attacked', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('attack-detail')).toHaveCount(0);

    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    await expect(page.getByTestId('attack-detail')).toBeVisible();
    await expect(page.getByTestId('file-debrief')).toBeDisabled();
    await expect(page.getByTestId('debrief-blockers')).toContainText('Say what hour the attack landed.');
    await expect(page.getByTestId('debrief-blockers')).toContainText('Say how it went.');

    await debrief(page).getByLabel('What hour it landed').selectOption('15');
    await debrief(page).getByRole('radio', { name: 'Trigger: Low energy' }).click();
    await debrief(page).getByRole('radio', { name: 'Outcome: It won' }).click();
    await expect(page.getByTestId('file-debrief')).toBeEnabled();

    await page.getByTestId('file-debrief').click();
    expect(await filedDebrief(page)).toMatchObject({
      attacked: true,
      occurredAtHour: 15,
      triggerKind: 'low_energy',
      outcome: 'lost',
    });
  });

  test('records the lie in his own words', async ({ page }) => {
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    await debrief(page).getByLabel('What hour it landed').selectOption('15');
    await debrief(page).getByRole('radio', { name: 'Trigger: Low energy' }).click();
    await debrief(page).getByRole('radio', { name: 'Outcome: It won' }).click();
    await debrief(page).getByLabel('The exact lie he told you').fill('You need a quick boost');
    await page.getByTestId('file-debrief').click();

    expect((await filedDebrief(page))?.propaganda).toBe('You need a quick boost');
  });

  test('clears the attack detail when he amends it to a quiet day', async ({ page }) => {
    // Mirror: debriefs_outcome_iff_attacked, and file_debrief deleting the tactic row. Left set,
    // the write bounces — and the screen would be showing a fight the record says never happened.
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    await debrief(page).getByLabel('What hour it landed').selectOption('15');
    await debrief(page).getByRole('radio', { name: 'Trigger: Low energy' }).click();
    await debrief(page).getByRole('radio', { name: 'Outcome: It won' }).click();

    await quietDay(page);
    await expect(page.getByTestId('attack-detail')).toHaveCount(0);
    await page.getByTestId('file-debrief').click();

    expect(await filedDebrief(page)).toMatchObject({
      attacked: false,
      outcome: null,
      occurredAtHour: null,
      triggerKind: null,
      propaganda: null,
    });
  });

  test('requires both halves of an insight or neither', async ({ page }) => {
    // A system with no victory is a habit; a victory with no system is a feeling. Mirror:
    // debriefs_insight_paired.
    await open(page);
    await quietDay(page);
    await debrief(page).getByLabel('The system you used').fill('Laid gym clothes out');
    await expect(page.getByTestId('file-debrief')).toBeDisabled();
    await expect(page.getByTestId('debrief-blockers')).toContainText(
      'Name what the system actually won you.',
    );

    await debrief(page).getByLabel('What it won you').fill('Out the door before he could argue');
    await expect(page.getByTestId('file-debrief')).toBeEnabled();
    await page.getByTestId('file-debrief').click();

    expect(await filedDebrief(page)).toMatchObject({
      systemUsed: 'Laid gym clothes out',
      victory: 'Out the door before he could argue',
    });
  });

  test('names the enemy rather than blaming the man', async ({ page }) => {
    // DOCTRINE §6.2. The labels are the instruction, so they are asserted like any other rule.
    await open(page);
    await expect(debrief(page)).toContainText('Bottom G Tactic');
    await expect(debrief(page)).toContainText('Not what you did wrong — what the enemy did');

    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    await expect(debrief(page)).toContainText('Being attacked is not a failure. Losing one is information.');
    await expect(debrief(page)).toContainText('The exact lie he told you');

    // The words this screen must never use about him.
    const text = (await debrief(page).textContent()) ?? '';
    for (const word of ['weak', 'failure to', 'you failed', 'shame', 'lazy', 'excuse']) {
      expect(text.toLowerCase(), `the debrief calls him "${word}"`).not.toContain(word);
    }
  });

  test('says the hour is his own local time', async ({ page }) => {
    // The claim the whole feature rests on, and the one a man filing from another country needs
    // stated rather than assumed.
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    await expect(debrief(page)).toContainText('Your local time');
    // The current hour is marked, because most attacks are logged shortly after they land.
    await expect(debrief(page).getByLabel('What hour it landed')).toContainText('15:00 — now');
  });

  test('offers all nine triggers from the doctrine', async ({ page }) => {
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    for (const label of [
      'Low energy',
      'Stress',
      'Boredom',
      'Loneliness',
      'Fatigue',
      'Celebration',
      'Social pressure',
      'Frustration',
      'Something else',
    ]) {
      await expect(debrief(page).getByRole('radio', { name: `Trigger: ${label}` })).toBeVisible();
    }
  });
});

test.describe('the attack pattern', () => {
  test('refuses to name a window before there is evidence', async ({ page }) => {
    // Three incidents dressed up as intelligence is how a man learns to ignore this screen.
    await open(page, '&attacks=3');
    const panel = page.getByTestId('attack-pattern');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('pattern-headline')).toContainText('3 attacks logged');
    await expect(page.getByTestId('pattern-headline')).toContainText('At 5 this will start telling you');
    await expect(page.getByTestId('pattern-headline')).not.toContainText('He attacks between');
  });

  test('names the window once the evidence is there', async ({ page }) => {
    await open(page, '&attacks=6');
    await expect(page.getByTestId('pattern-headline')).toContainText('He attacks between');
    await expect(page.getByTestId('pattern-headline')).toContainText('14:00');
    await expect(page.getByTestId('pattern-headline')).toContainText('16:00');
  });

  test('names his most effective enemy with the rate', async ({ page }) => {
    // "Low energy is his most successful weapon against you — you lose to it 2 times in 3."
    // DOCTRINE §6.3, delivered.
    await open(page, '&attacks=6');
    const worst = page.getByTestId('pattern-worst');
    await expect(worst).toContainText('Low energy');
    await expect(worst).toContainText('most effective weapon');
    await expect(worst).toContainText('2');
    await expect(worst).toContainText('3');
  });

  test('shows nothing at all with no attacks logged', async ({ page }) => {
    // An empty chart is worse than no chart: it reads as a broken screen.
    await open(page, '&attacks=0');
    await expect(page.getByTestId('attack-pattern')).toHaveCount(0);
  });

  test('gives the histogram an accessible reading', async ({ page }) => {
    // A bar chart that exists only visually is a chart with half its point missing.
    await open(page, '&attacks=6');
    await expect(page.getByRole('list', { name: /Attacks by hour of the day, 6 in total/ })).toBeVisible();
    await expect(page.getByRole('listitem', { name: '15:00: 3 attacks' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: '03:00: 0 attacks' })).toBeVisible();
  });

  test('draws bars in proportion to the counts', async ({ page }) => {
    // Asserted directly because the failure mode is silent: the bars are percentage heights, and
    // against an auto-height parent every one of them computes to zero. The chart then renders as
    // a flat line that looks like a day with no attacks — a wrong answer, delivered confidently.
    await open(page, '&attacks=6');
    const bars = await page
      .getByRole('list', { name: /Attacks by hour/ })
      .locator('li > div')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));

    expect(bars).toHaveLength(24);
    const busiest = bars[15] ?? 0; // 15:00 holds three attacks, the most of any hour
    const quieter = bars[9] ?? 0; // 09:00 holds one
    const empty = bars[3] ?? 0;

    expect(busiest, 'the tallest bar has no height').toBeGreaterThan(10);
    expect(busiest).toBeGreaterThan(quieter);
    expect(quieter).toBeGreaterThan(empty);
    expect(empty, 'an empty hour should still show a hairline').toBeGreaterThan(0);
  });
});

test.describe('the debrief screen holds up', () => {
  test('gives every control an accessible name', async ({ page }) => {
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    const unnamed = await unnamedControls(debrief(page));
    expect(unnamed, `controls with no accessible name: ${unnamed.join(' | ')}`).toEqual([]);
  });

  test('keeps every tap target at 44px or more on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page);
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    const tooSmall = await smallTapTargets(debrief(page));
    expect(
      tooSmall,
      `tap targets under 44px: ${tooSmall.map((b) => `${b.text} ${b.width}x${b.height}`).join(', ')}`,
    ).toEqual([]);
  });

  test('does not overflow horizontally at any width', async ({ page }) => {
    // The histogram is twenty-four bars; 320px is where a naive one pushes the page sideways.
    await open(page, '&attacks=6');
    await debrief(page).getByRole('radio', { name: 'The Bottom G attacked' }).click();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow of ${overflow}px at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('never claims a debrief was saved when it was not', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('debrief-status')).toHaveText('Not filed yet.');
    await expect(page.getByTestId('debrief-status')).not.toHaveText(/[Ss]aved/);
  });
});
