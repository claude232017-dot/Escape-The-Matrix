/**
 * Detecting a password-recovery link **synchronously, at first paint**.
 *
 * The problem this solves: Supabase exchanges the token in the URL for a real session
 * during client initialisation. That is asynchronous. If the app decides what to render
 * before the exchange completes, it renders the signed-out view and then flashes the
 * dashboard; if it waits, it has already rendered something. Either way the emailed link
 * has produced a usable session without the person setting a password.
 *
 * The fix is to not ask the auth library at all for this decision. The redirect URL
 * carries a parameter **we** control, readable from `window.location` before any promise
 * resolves, and its presence pins the reset view from the very first render.
 */

/** Query parameter we add to the recovery redirect URL. Ours, not Supabase's. */
export const RECOVERY_PARAM = 'mode';
export const RECOVERY_VALUE = 'reset';

/** The redirect URL to hand to `resetPasswordForEmail`. */
export function buildRecoveryRedirectUrl(origin: string): string {
  const url = new URL(origin);
  url.searchParams.set(RECOVERY_PARAM, RECOVERY_VALUE);
  return url.toString();
}

/**
 * True when this URL indicates a recovery flow.
 *
 * Checks three places, because relying on one is fragile:
 *
 *  1. Our own `?mode=reset` — the reliable signal, present before the token is exchanged.
 *  2. `type=recovery` in the hash fragment — what Supabase's implicit flow puts there.
 *  3. `?type=recovery` in the query — the PKCE-flow equivalent.
 *
 * Any one of them holds the reset screen. A false positive costs a man one extra click; a
 * false negative turns an email into a standing credential.
 */
export function isRecoveryUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }

  if (url.searchParams.get(RECOVERY_PARAM) === RECOVERY_VALUE) return true;
  if (url.searchParams.get('type') === 'recovery') return true;

  // The fragment is `#access_token=...&type=recovery&...` — parse it as a query string.
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (fragment) {
    const params = new URLSearchParams(fragment);
    if (params.get('type') === 'recovery') return true;
  }

  return false;
}

/**
 * Strip the recovery markers from the URL once the password has actually been changed.
 *
 * Called only on success. Clearing it earlier — on mount, say — would mean a reload during
 * the reset drops the person into the app with the session the link created, which is the
 * whole failure this module exists to prevent.
 */
export function stripRecoveryFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(RECOVERY_PARAM);
  url.searchParams.delete('type');
  url.hash = '';
  return url.toString();
}
