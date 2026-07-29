import type { ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { SignInScreen } from '@/features/auth/components/SignInScreen';
import { ResetPasswordScreen } from '@/features/auth/components/ResetPasswordScreen';
import { DisclosureScreen } from '@/features/auth/components/DisclosureScreen';
import { ProfileMissingScreen } from '@/features/auth/components/ProfileMissingScreen';
import { AuthShell } from '@/features/auth/components/AuthShell';

/**
 * The single place that decides whether application content may render.
 *
 * One switch over an exhaustive union, so a new view cannot be added without deciding what
 * it shows. `children` is reached in exactly one branch — that is the property worth
 * preserving, because the failure mode here is a screen that renders the app *and* an
 * overlay, leaving the app reachable underneath.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { view } = useAuth();

  switch (view) {
    case 'loading':
      return (
        <AuthShell title="Loading">
          {/* aria-busy rather than a spinner: there is nothing to look at yet, and an
              animated placeholder implies progress we cannot measure. */}
          <p aria-busy="true" className="text-sm text-text-muted">
            Checking your session…
          </p>
        </AuthShell>
      );
    case 'sign-in':
      return <SignInScreen />;
    case 'reset-password':
      return <ResetPasswordScreen />;
    case 'disclosure':
      return <DisclosureScreen />;
    case 'profile-missing':
      return <ProfileMissingScreen />;
    case 'app':
      return <>{children}</>;
  }
}
