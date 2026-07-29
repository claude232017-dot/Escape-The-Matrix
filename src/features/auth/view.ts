/**
 * Which screen the app is allowed to show, as a pure function.
 *
 * Pure and separate from React because the ordering rules here are the security-relevant
 * part of Phase 1's client, and they need to be testable without a browser, a session or a
 * mocked auth library.
 *
 * The rule that matters most: **recovery beats everything.** A password-recovery link
 * produces a real, fully-valid session when the token is exchanged on load. If any other
 * view can win, that emailed link has silently become a standing credential — someone who
 * reads the email can browse the app indefinitely without ever setting a password.
 */

export type AuthView =
  /** Session state not yet known. Show a shell, never content. */
  | 'loading'
  /** No session. Invite-only, so this is sign-in — there is no signup form. */
  | 'sign-in'
  /** A recovery link is in play. Full-screen, no navigation out. */
  | 'reset-password'
  /** Signed in, but has not been shown what the mentor can see. ADR-009. */
  | 'disclosure'
  /** Signed in with a profile and an accepted disclosure. */
  | 'app'
  /**
   * Signed in, profile row absent. The signup trigger failed or is missing — see
   * docs/RUNBOOK.md. Surfaced explicitly because the alternative is an empty dashboard
   * nobody can explain.
   */
  | 'profile-missing';

export interface AuthInputs {
  /**
   * True when a recovery link is in play. Derived synchronously from the URL at first
   * paint — see isRecoveryUrl — and also set by the PASSWORD_RECOVERY event. Both, because
   * the URL is available before the auth library has finished and the event is the
   * authoritative signal afterwards.
   */
  recoveryActive: boolean;
  /** Null when signed out. */
  session: { userId: string } | null;
  /** Null when not loaded or absent. Distinguished from absent by `profileLoading`. */
  profile: { disclosureAcceptedAt: string | null } | null;
  /** True while the profile fetch is in flight. */
  profileLoading: boolean;
  /** True before the auth library has reported initial session state. */
  sessionLoading: boolean;
}

export function resolveAuthView(inputs: AuthInputs): AuthView {
  // First, unconditionally, and before the session is even known. Holding this from first
  // paint is what stops the dashboard flashing on screen while the token is exchanged.
  if (inputs.recoveryActive) return 'reset-password';

  if (inputs.sessionLoading) return 'loading';
  if (inputs.session === null) return 'sign-in';
  if (inputs.profileLoading) return 'loading';

  // Signed in, profile fetch finished, no row. Not an empty state — a broken one.
  if (inputs.profile === null) return 'profile-missing';

  // The disclosure is what makes the mentor's access to special-category data legitimate,
  // so it blocks rather than nags. See ADR-009.
  if (inputs.profile.disclosureAcceptedAt === null) return 'disclosure';

  return 'app';
}

/** Views that must never render application content or navigation. */
const CONTENT_FORBIDDEN: ReadonlySet<AuthView> = new Set<AuthView>([
  'loading',
  'sign-in',
  'reset-password',
  'disclosure',
  'profile-missing',
]);

/**
 * Whether the app chrome — nav, member list, anything linking elsewhere — may render.
 *
 * Exists as its own predicate so a future screen cannot accidentally gain navigation by
 * being added to a layout: the answer is a lookup, not a judgement at each call site.
 */
export function mayRenderAppContent(view: AuthView): boolean {
  return !CONTENT_FORBIDDEN.has(view);
}
