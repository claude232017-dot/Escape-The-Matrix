import { Motion } from '@/app/Motion';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { SignedInShell } from '@/app/SignedInShell';

/**
 * Composition root.
 *
 * The boundary is outermost so that a throw anywhere — including inside the auth provider,
 * which is where a bad session or a malformed profile row would surface — still produces a
 * screen with words on it rather than a blank document.
 *
 * `AuthGate` is the only thing that can render `SignedInShell`, from exactly one branch of an
 * exhaustive switch. Nothing below the gate needs to re-check whether a session exists.
 */
export function App() {
  return (
    <ErrorBoundary>
      <Motion>
        <AuthProvider>
          <AuthGate>
            <SignedInShell />
          </AuthGate>
        </AuthProvider>
      </Motion>
    </ErrorBoundary>
  );
}
