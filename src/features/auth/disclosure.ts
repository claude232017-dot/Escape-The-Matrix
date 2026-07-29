/**
 * The disclosure version, in its own module.
 *
 * Separate from the component so the file exporting it contains only a constant: a module
 * that mixes a component with a shared value defeats Fast Refresh, and the value is needed
 * by both the screen and anything that later checks whether re-consent is due.
 *
 * Bumped when the wording changes **materially** — i.e. when it changes what a man is
 * agreeing to, not when a typo is fixed. A bump means every member is asked again, so an
 * unnecessary one trains people to click through the thing they are supposed to read.
 *
 * Tracks the edition of docs/DOCTRINE.md that describes the visibility rules, and is
 * stored in `profiles.disclosure_version` so a past acceptance can always be resolved to
 * the exact text it applied to.
 */
export const DISCLOSURE_VERSION = '2026.07-draft';
