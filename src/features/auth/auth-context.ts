import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AuthView } from '@/features/auth/view';

/**
 * The auth context, its types, and the hook that reads it.
 *
 * Split out of AuthProvider.tsx so that file exports **only components**. That is what Vite's
 * Fast Refresh needs: it can hot-swap a component in place, but a module that also exports a
 * plain function has to be re-executed wholesale, so editing the provider forced a full page
 * reload and dropped the session every time. Signing in again after every keystroke-sized edit
 * is a small tax paid constantly.
 *
 * `Provider` and `useAuth` in one file is the ordinary React idiom, and the lint rule and the
 * idiom genuinely disagree — this is the standard way out of that, not a workaround for a
 * mistake.
 */

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  /** Captured at signup because every future day count is measured against it. */
  timezone: string;
}

export interface Profile {
  id: string;
  circleId: string;
  displayName: string;
  timezone: string;
  role: 'mentor' | 'member';
  /** His creed, shown inline by the Morning Protocol MED. Null when never written. */
  topGCode: string | null;
  commandPostNote: string | null;
  fortressProtocol: string | null;
  disclosureAcceptedAt: string | null;
  disclosureVersion: string | null;
}

export interface AuthContextValue {
  view: AuthView;
  session: Session | null;
  profile: Profile | null;
  /** Non-null when the last operation failed. Plain text, safe to show. */
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to whether the man must confirm his email before he can sign in. */
  signUpWithInvitation: (input: SignUpInput) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  completePasswordReset: (newPassword: string) => Promise<void>;
  acceptDisclosure: (version: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
  busy: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
