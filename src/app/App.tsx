import { Motion } from '@/app/Motion';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { SignedInShell } from '@/app/SignedInShell';

/**
 * Composition root.
 *
 * `AuthGate` is the only thing that can render `SignedInShell`, and it does so from exactly
 * one branch of an exhaustive switch. Nothing below the gate needs to re-check whether a
 * session exists.
 */
export function App() {
  return (
    <Motion>
      <AuthProvider>
        <AuthGate>
          <SignedInShell />
        </AuthGate>
      </AuthProvider>
    </Motion>
  );
}
