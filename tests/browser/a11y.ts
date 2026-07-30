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
 * Resolves the three sources that actually give a control its name here: `aria-label`, a
 * `<label for>` pointing at it, and its own text content. Deliberately not a full accname
 * implementation — it is a smoke test for the omission that matters (a control a screen reader
 * announces as "button"), not a spec conformance suite.
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
 */
export async function smallTapTargets(
  scope: Locator,
): Promise<{ text: string; width: number; height: number }[]> {
  return scope
    .locator('[role="radio"], button, select, input:not([type="hidden"])')
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return {
            text: element.textContent?.trim().slice(0, 30) ?? '',
            width: box.width,
            height: box.height,
          };
        })
        .filter((box) => box.width > 0 && box.height < 44),
    );
}
