import { describe, expect, it } from 'vitest';
import { mayRenderAppContent, resolveAuthView, type AuthInputs } from '@/features/auth/view';

const base: AuthInputs = {
  recoveryActive: false,
  session: null,
  profile: null,
  profileLoading: false,
  sessionLoading: false,
};

const signedIn = { userId: 'u1' };
const accepted = { disclosureAcceptedAt: '2026-07-29T10:00:00Z' };
const notAccepted = { disclosureAcceptedAt: null };

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
          for (const profile of [null, accepted, notAccepted]) {
            const view = resolveAuthView({
              recoveryActive: true,
              sessionLoading,
              profileLoading,
              session,
              profile,
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
