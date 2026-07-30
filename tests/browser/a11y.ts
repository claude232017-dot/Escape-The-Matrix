import type { Locator } from '@playwright/test';

/**
 * Shared accessibility probes.
 *
 * Shared because the alternative already failed: the SITREP spec and the debrief spec each grew
 * their own "does every control have a name" check, they resolved names differently, and the
 * weaker one reported a false failure against controls that were correctly labelled. A guardrail
 * that disagrees with itself teaches people to distrust it.
 */

/**
 * Controls with no accessible name, within `scope`.
 *
 * Resolves the four sources that actually give a control its name here: `aria-label`, a
 * `<label for>` pointing at it, a `<label>` **wrapping** it, and its own text content. The
 * wrapping case was missing and produced a false failure against a correctly labelled checkbox —
 * a guardrail that cries wolf gets deleted, so it is worth getting right rather than working
 * around. Deliberately not a full accname implementation; it is a smoke test for the omission
 * that matters (a control announced as "checkbox" and nothing else).
 */
export async function unnamedControls(scope: Locator): Promise<string[]> {
  return scope
    .locator('a, button, input, select, textarea, [role="button"], [role="link"], [role="radio"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const id = element.getAttribute('id');
          const labelled = element.getAttribute('aria-labelledby');
          const name =
            element.getAttribute('aria-label') ??
            (labelled ? document.getElementById(labelled)?.textContent : null) ??
            (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null) ??
            element.closest('label')?.textContent ??
            element.getAttribute('title') ??
            element.textContent ??
            '';
          return name.trim() === '';
        })
        .map((element) => element.outerHTML.slice(0, 120)),
    );
}

/**
 * Tap targets smaller than 44px tall, within `scope`.
 *
 * Height only. Width is checked by the no-horizontal-overflow test, and a control that is 76px
 * wide in a four-across row is fine — insisting on 44 in both directions would forbid the SITREP's
 * answer control on a 360px screen for no benefit anyone can feel with a thumb.
 *
 * An input wrapped in a `<label>` is measured by the **label**, because that is what a thumb
 * actually hits: clicking anywhere in the label activates the control. Measuring the 16px
 * checkbox instead reported a failure for a row that is comfortably 44px tall.
 */
export async function smallTapTargets(
  scope: Locator,
): Promise<{ text: string; width: number; height: number }[]> {
  return scope
    .locator('[role="radio"], button, select, input:not([type="hidden"])')
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const target = element.closest('label') ?? element;
          const box = target.getBoundingClientRect();
          return {
            text: (target.textContent ?? element.outerHTML).trim().slice(0, 30),
            width: box.width,
            height: box.height,
          };
        })
        .filter((box) => box.width > 0 && box.height < 44),
    );
}
