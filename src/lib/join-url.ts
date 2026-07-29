/**
 * The link a mentor sends with an invitation.
 *
 * In `lib` because two features need it: `circle` builds it for the mentor to send, and
 * `auth` reads it to decide which signed-out screen to show. A feature importing another
 * feature is the knot the import-graph test rejects — and re-exporting one from the other
 * does not change the dependency, only how well it is hidden.
 *
 * `?join=1` opens the setup screen directly, so an invited man is not left guessing which of
 * two forms applies to him. It carries no authority whatsoever — it is a convenience, and the
 * actual gate is the `BEFORE INSERT` trigger on `auth.users`. Anyone can add the parameter
 * and get a form that will refuse them.
 *
 * Deliberately not the invitation token: putting the token in a URL people paste into chat
 * would make it a credential in a place credentials leak, and it currently grants nothing, so
 * exposing it would only create a liability with no benefit.
 */
export const JOIN_PARAM = 'join';
export const JOIN_VALUE = '1';

export function buildJoinUrl(origin: string): string {
  const url = new URL(origin);
  url.searchParams.set(JOIN_PARAM, JOIN_VALUE);
  return url.toString();
}

export function isJoinUrl(href: string): boolean {
  try {
    return new URL(href).searchParams.get(JOIN_PARAM) === JOIN_VALUE;
  } catch {
    // A malformed URL must not blank the app on first paint.
    return false;
  }
}
