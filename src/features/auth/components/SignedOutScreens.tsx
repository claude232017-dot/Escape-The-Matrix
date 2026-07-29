import { useState } from 'react';
import { SignInScreen } from '@/features/auth/components/SignInScreen';
import { FirstTimeSetupScreen } from '@/features/auth/components/FirstTimeSetupScreen';
import { isJoinUrl } from '@/lib/join-url';

/**
 * The two signed-out screens, and the toggle between them.
 *
 * Kept out of `resolveAuthView` on purpose. That function answers "what is this session
 * allowed to see?", which is a security question with an exhaustive answer; whether a
 * signed-out man is looking at sign-in or at setup is a UI preference. Mixing the two would
 * mean every future change to a toggle had to be re-reasoned against the recovery rule.
 *
 * Because this lives entirely inside the `sign-in` branch, recovery still outranks both.
 */
export function SignedOutScreens() {
  // Read once from the URL so an invitation email can link straight here. State, not derived,
  // so that choosing the other screen actually sticks.
  const [mode, setMode] = useState<'sign-in' | 'setup'>(() =>
    typeof window !== 'undefined' && isJoinUrl(window.location.href) ? 'setup' : 'sign-in',
  );

  return mode === 'setup' ? (
    <FirstTimeSetupScreen onUseSignIn={() => setMode('sign-in')} />
  ) : (
    <SignInScreen onUseFirstTimeSetup={() => setMode('setup')} />
  );
}
