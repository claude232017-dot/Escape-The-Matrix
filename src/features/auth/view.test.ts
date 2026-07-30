import { describe, expect, it } from 'vitest';
import { mayRenderAppContent, resolveAuthView, type AuthInputs } from '@/features/auth/view';

const CURRENT = '2026.07-draft';

const base: AuthInputs = {
  recoveryActive: false,
  session: null,
  profile: null,
  currentDisclosureVersion: CURRENT,
  profileLoading: false,
  sessionLoading: false,
};

const signedIn = { userId: 'u1' };
const accepted = { disclosureAcceptedAt: '2026-07-29T10:00:00Z', disclosureVersion: CURRENT };
const notAccepted = { disclosureAcceptedAt: null, disclosureVersion: null };
/** Accepted, but against wording that has since been replaced. */
const acceptedOldVersion = {
  disclosureAcceptedAt: '2026-07-29T10:00:00Z',
  disclosureVersion: '2026.01-draft',
};

describe('resolveAuthView', () => {
  it('shows sign-in when there is no session', () => {
    expect(resolveAuthView(base)).toBe('sign-in');
  });

  it('shows loading before the session is known, never content', () => {
    expect(resolveAuthView({ ...base, sessionLoading: true })).toBe('loading');
    expect(mayRenderAppContent('loading')).toBe(false);
  });

  it('shows loading while the profile is in flight', () => {
    expect(
      resolveAuthView({ ...base, session: signedIn, profileLoading: true }),
    ).toBe('loading');
  });

  it('reaches the app only with a session, a profile and an accepted disclosure', () => {
    expect(resolveAuthView({ ...base, session: signedIn, profile: accepted })).toBe('app');
  });

  it('blocks the app until the disclosure is accepted', () => {
    // ADR-009: the disclosure is what makes the mentor's access to special-category data
    // legitimate, so it blocks rather than nags.
    expect(resolveAuthView({ ...base, session: signedIn, profile: notAccepted })).toBe(
      'disclosure',
    );
    expect(mayRenderAppContent('disclosure')).toBe(false);
  });

  it('asks again when the disclosure has changed since he accepted it', () => {
    // SECURITY.md §3: re-consent when the text materially changes. Consent to one disclosure is
    // not consent to a different one — if a new sensitive protocol is added, or who can read
    // what changes, an acceptance recorded against the old wording stops counting.
    //
    // Without this, `profiles.disclosure_version` is written on acceptance and then never read
    // by anything, which is a control that exists only in a document.
    expect(resolveAuthView({ ...base, session: signedIn, profile: acceptedOldVersion })).toBe(
      'disclosure',
    );
  });

  it('asks again when the accepted version is missing or unrecognised', () => {
    // There is no ordering on these strings, and inventing one would mean guessing which
    // changes were material. Anything that is not an exact match re-asks.
    for (const disclosureVersion of [null, '', 'not-a-version', '2099.12-final']) {
      expect(
        resolveAuthView({
          ...base,
          session: signedIn,
          profile: { disclosureAcceptedAt: '2026-07-29T10:00:00Z', disclosureVersion },
        }),
        `version ${String(disclosureVersion)} was let through`,
      ).toBe('disclosure');
    }
  });

  it('does not ask again when the version still matches', () => {
    // The other half of the rule. A gate that always fires is a gate nobody can accept past.
    expect(resolveAuthView({ ...base, session: signedIn, profile: accepted })).toBe('app');
  });

  it('names the missing-profile case instead of showing an empty app', () => {
    // Signed in, fetch finished, no row: the signup trigger failed or was dropped. An
    // empty dashboard here is a support ticket nobody can diagnose.
    expect(resolveAuthView({ ...base, session: signedIn, profile: null })).toBe(
      'profile-missing',
    );
  });
});

describe('recovery beats everything — the §3.7 requirement', () => {
  it('holds the reset screen even before the session is known', () => {
    // This is the case that matters: first paint, token not yet exchanged. Anything other
    // than 'reset-password' here means the dashboard flashes on screen.
    expect(
      resolveAuthView({ ...base, recoveryActive: true, sessionLoading: true }),
    ).toBe('reset-password');
  });

  it('holds the reset screen even with a full valid session', () => {
    // The recovery link produces a REAL session. If a session could win, the emailed link
    // would be a standing credential: read the email, browse the app, never set a password.
    expect(
      resolveAuthView({ ...base, recoveryActive: true, session: signedIn, profile: accepted }),
    ).toBe('reset-password');
  });

  it('holds the reset screen over the disclosure gate too', () => {
    expect(
      resolveAuthView({
        ...base,
        recoveryActive: true,
        session: signedIn,
        profile: notAccepted,
      }),
    ).toBe('reset-password');
  });

  it('holds the reset screen over the missing-profile screen', () => {
    expect(
      resolveAuthView({ ...base, recoveryActive: true, session: signedIn, profile: null }),
    ).toBe('reset-password');
  });

  it('wins from every possible combination of the other inputs', () => {
    // Exhaustive rather than representative: this is the one rule where a single missed
    // combination is a security hole, so the test enumerates all of them.
    for (const sessionLoading of [true, false]) {
      for (const profileLoading of [true, false]) {
        for (const session of [null, signedIn]) {
          // Including the stale-version profile: re-consent is a blocking view too, and
          // recovery has to beat it for the same reason it beats the first disclosure.
          for (const profile of [null, accepted, notAccepted, acceptedOldVersion]) {
            const view = resolveAuthView({
              recoveryActive: true,
              sessionLoading,
              profileLoading,
              session,
              profile,
              currentDisclosureVersion: CURRENT,
            });
            expect(
              view,
              `recovery lost to session=${JSON.stringify(session)} profile=${JSON.stringify(profile)} sessionLoading=${sessionLoading} profileLoading=${profileLoading}`,
            ).toBe('reset-password');
          }
        }
      }
    }
  });

  it('never permits app content on the reset screen', () => {
    expect(mayRenderAppContent('reset-password')).toBe(false);
  });
});

describe('mayRenderAppContent', () => {
  it('permits content only in the app view', () => {
    expect(mayRenderAppContent('app')).toBe(true);
    for (const view of [
      'loading',
      'sign-in',
      'reset-password',
      'disclosure',
      'profile-missing',
    ] as const) {
      expect(mayRenderAppContent(view), view).toBe(false);
    }
  });
});
