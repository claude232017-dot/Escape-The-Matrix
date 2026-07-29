/**
 * Invitation tokens.
 *
 * Generated in the browser with `crypto.getRandomValues`, never `Math.random`: a guessable
 * invitation token is a public signup form with extra steps, and `Math.random` is
 * predictable from a handful of prior outputs.
 *
 * The token is not currently a secret that grants anything on its own — membership is
 * decided by matching the invited *email* at signup, so possession of a token does not let
 * a stranger in. It is unguessable anyway, because that will stop being true the moment
 * invitations are ever accepted by link.
 */

/** 32 hex characters = 128 bits. SQL: invitations_token_length allows 16–128. */
const TOKEN_BYTES = 16;

/**
 * `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`: the latter admits a
 * SharedArrayBuffer backing, which `crypto.getRandomValues` refuses at runtime.
 */
type RandomBytes = Uint8Array<ArrayBuffer>;

export function generateInvitationToken(
  randomValues: (array: RandomBytes) => RandomBytes = (array) => crypto.getRandomValues(array),
): string {
  const bytes = randomValues(new Uint8Array(TOKEN_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Default invitation lifetime. Long enough to be answered, short enough to expire. */
export const INVITATION_TTL_DAYS = 14;

export function invitationExpiry(from: Date = new Date()): string {
  const expires = new Date(from.getTime() + INVITATION_TTL_DAYS * 86_400_000);
  // `expires_at` is timestamptz: an instant, not a calendar date. The ban on toISOString()
  // exists to stop a *date* being derived in UTC when it should be resolved in the member's
  // timezone; an expiry is the same moment for everyone, and ISO-8601 is the right wire
  // format for it.
  // eslint-disable-next-line no-restricted-syntax -- instant, not a calendar date
  return expires.toISOString();
}

/**
 * The link to send with an invitation.
 *
 * Re-exported here so the invite UI has one obvious place to reach for, and so the reasoning
 * about what the link is *not* stays next to the token generation: it carries no authority
 * and deliberately contains no token. The gate is the BEFORE INSERT trigger on auth.users.
 */
export { buildJoinUrl as joinLink } from '@/lib/join-url';
