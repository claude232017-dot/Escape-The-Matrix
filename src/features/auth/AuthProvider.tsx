import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { clearUserState } from '@/lib/local-state';
import { isRecoveryUrl, stripRecoveryFromUrl } from '@/features/auth/recovery';
import { resolveAuthView, type AuthView } from '@/features/auth/view';

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
  disclosureAcceptedAt: string | null;
  disclosureVersion: string | null;
}

interface AuthContextValue {
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

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Read synchronously, at module scope, before React renders anything.
 *
 * This is the whole §3.7 mechanism: the recovery decision is made from the URL rather than
 * awaited from the auth library, so the reset screen is pinned from the very first paint
 * instead of appearing after the dashboard has already flashed.
 */
const INITIAL_RECOVERY =
  typeof window !== 'undefined' ? isRecoveryUrl(window.location.href) : false;

/**
 * Whether this build has Supabase keys at all, decided once at module scope.
 *
 * Synchronous, so the "not configured" case is a derived value rather than state set from
 * inside an effect. There is nothing to wait for: a deployment either shipped the env vars
 * or it did not, and pretending to load while we already know the answer just delays an
 * error the operator needs to see.
 */
const SUPABASE_CONFIGURED = isSupabaseConfigured();
const NOT_CONFIGURED_MESSAGE =
  'This deployment has no Supabase configuration. See docs/RUNBOOK.md.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(SUPABASE_CONFIGURED);
  const [recoveryActive, setRecoveryActive] = useState(INITIAL_RECOVERY);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The profile fetch result, tagged with the user it belongs to.
   *
   * Tagged rather than stored as two pieces of state so that "loading" is *derived* — we
   * are loading exactly when we do not yet hold a result for the current user. That removes
   * the need to set a loading flag synchronously inside an effect (which causes cascading
   * renders) and, more usefully, makes it impossible to show one member's profile while a
   * different member's session is active: a stale result simply fails the id comparison.
   */
  const [profileResult, setProfileResult] = useState<{
    userId: string;
    profile: Profile | null;
  } | null>(null);

  // Remembered so sign-out can clear the right namespace: by the time signOut resolves the
  // session is gone, and clearing "the current user" would then clear nobody.
  const lastUserId = useRef<string | null>(null);

  /** Pure fetch — sets no state, so it is safe to start from an effect body. */
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error: queryError } = await getSupabase()
      .from('profiles')
      .select('id, circle_id, display_name, timezone, role, disclosure_accepted_at, disclosure_version')
      .eq('id', userId)
      .maybeSingle();

    if (queryError) throw queryError;
    // maybeSingle returns null rather than throwing when the row is absent, which is the
    // orphaned-profile case the 'profile-missing' view exists to name.
    if (!data) return null;
    return {
      id: data.id as string,
      circleId: data.circle_id as string,
      displayName: data.display_name as string,
      timezone: data.timezone as string,
      role: data.role as 'mentor' | 'member',
      disclosureAcceptedAt: data.disclosure_accepted_at as string | null,
      disclosureVersion: data.disclosure_version as string | null,
    };
  }, []);

  const loadProfile = useCallback(
    async (userId: string) => {
      try {
        setProfileResult({ userId, profile: await fetchProfile(userId) });
      } catch (cause) {
        setProfileResult({ userId, profile: null });
        setOperationError(messageFor(cause));
      }
    },
    [fetchProfile],
  );

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    const supabase = getSupabase();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        if (data.session) lastUserId.current = data.session.user.id;
      })
      .finally(() => setSessionLoading(false));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Handled explicitly rather than treated as an ordinary sign-in. Without this branch
      // the recovery session is indistinguishable from a normal one and the emailed link
      // becomes a standing credential.
      if (event === 'PASSWORD_RECOVERY') setRecoveryActive(true);

      setSession(nextSession);
      if (nextSession) lastUserId.current = nextSession.user.id;
      setSessionLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Do not fetch a profile during recovery: nothing may be shown but the reset form, so
    // the request would be work whose result can never be rendered.
    if (recoveryActive || !session) return;
    const userId = session.user.id;
    let cancelled = false;
    // State is set in the promise callbacks, never synchronously in the effect body. The
    // cancelled flag stops a slow response from one session landing after another has begun.
    fetchProfile(userId)
      .then((profile) => {
        if (!cancelled) setProfileResult({ userId, profile });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProfileResult({ userId, profile: null });
        setOperationError(messageFor(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [session, recoveryActive, fetchProfile]);

  // A missing configuration outranks any operation error: nothing can work without keys, so
  // showing "wrong password" over "this deployment has no backend" would misdirect entirely.
  const error = SUPABASE_CONFIGURED ? operationError : NOT_CONFIGURED_MESSAGE;

  // Derived, not stored. A result tagged with a different user id is stale by definition, so
  // it can never be shown, and "loading" is simply the absence of a matching result.
  const profile = session && profileResult?.userId === session.user.id ? profileResult.profile : null;
  const profileLoading =
    session !== null && !recoveryActive && profileResult?.userId !== session.user.id;

  const signIn = useCallback(async (email: string, password: string) => {
    setBusy(true);
    setOperationError(null);
    try {
      const { error: authError } = await getSupabase().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;
    } catch (cause) {
      setOperationError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const signUpWithInvitation = useCallback(
    async (input: SignUpInput): Promise<{ needsEmailConfirmation: boolean }> => {
      setBusy(true);
      setOperationError(null);
      try {
        // Safe to expose precisely BECAUSE the BEFORE INSERT trigger on auth.users rejects
        // an uninvited address. The gate is in the database; this form only reaches it.
        const { data, error: authError } = await getSupabase().auth.signUp({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          options: {
            // Read by app.create_profile_for_new_user() to populate the profile. The
            // timezone especially: it decides every day count this man will ever have.
            data: { display_name: input.displayName.trim(), timezone: input.timezone },
            emailRedirectTo: window.location.origin,
          },
        });
        if (authError) throw authError;
        // A null session means GoTrue is configured to require email confirmation. Not an
        // error, but the difference decides what the screen says next.
        return { needsEmailConfirmation: data.session === null };
      } catch (cause) {
        setOperationError(messageFor(cause));
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      const userId = lastUserId.current;
      await getSupabase().auth.signOut();
      // §3.8. Anything queued or drafted on this device belongs to the man signing out; if
      // it survives, the next person inherits it, it flushes under their session, RLS
      // rejects it, and they are shown a stranger's error.
      if (userId) clearUserState(window.localStorage, userId);
      lastUserId.current = null;
      setProfileResult(null);
      setOperationError(null);
    } catch (cause) {
      setOperationError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    setBusy(true);
    setOperationError(null);
    try {
      const { buildRecoveryRedirectUrl } = await import('@/features/auth/recovery');
      const { error: authError } = await getSupabase().auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: buildRecoveryRedirectUrl(window.location.origin) },
      );
      if (authError) throw authError;
    } catch (cause) {
      setOperationError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const completePasswordReset = useCallback(async (newPassword: string) => {
    setBusy(true);
    setOperationError(null);
    try {
      const { error: authError } = await getSupabase().auth.updateUser({ password: newPassword });
      if (authError) throw authError;
      // Only now. Clearing the markers any earlier would mean a reload mid-reset drops the
      // person into the app holding the session the link created.
      window.history.replaceState({}, '', stripRecoveryFromUrl(window.location.href));
      setRecoveryActive(false);
    } catch (cause) {
      setOperationError(messageFor(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const acceptDisclosure = useCallback(
    async (version: string) => {
      if (!session) return;
      setBusy(true);
      setOperationError(null);
      try {
        const { error: updateError } = await getSupabase()
          .from('profiles')
          // Both columns together — the SQL CHECK profiles_disclosure_complete rejects a
          // timestamp with no version, because that cannot answer what he agreed to.
          //
          // An instant, not a calendar date. The ban on toISOString() exists to stop a
          // *date* being derived in UTC when it must be resolved in the member's timezone;
          // "when did he accept" is the same moment for everyone.
          // eslint-disable-next-line no-restricted-syntax -- instant, not a calendar date
          .update({ disclosure_accepted_at: new Date().toISOString(), disclosure_version: version })
          .eq('id', session.user.id);
        if (updateError) throw updateError;
        await loadProfile(session.user.id);
      } catch (cause) {
        setOperationError(messageFor(cause));
      } finally {
        setBusy(false);
      }
    },
    [session, loadProfile],
  );

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const view = resolveAuthView({
    recoveryActive,
    session: session ? { userId: session.user.id } : null,
    profile: profile ? { disclosureAcceptedAt: profile.disclosureAcceptedAt } : null,
    profileLoading,
    sessionLoading,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      view,
      session,
      profile,
      error,
      busy,
      signIn,
      signUpWithInvitation,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      acceptDisclosure,
      refreshProfile,
    }),
    [
      view,
      session,
      profile,
      error,
      busy,
      signIn,
      signUpWithInvitation,
      signOut,
      requestPasswordReset,
      completePasswordReset,
      acceptDisclosure,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/**
 * Turn an unknown thrown value into something safe to put on screen.
 *
 * Deliberately does not pass a raw Postgres error through: a policy violation message can
 * name tables and columns, and it tells the person nothing they can act on.
 */
function messageFor(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const raw = String((cause as { message: unknown }).message);
    if (/invalid login credentials/i.test(raw)) return 'That email and password do not match.';
    if (/email not confirmed/i.test(raw)) return 'Confirm your email address first.';
    if (/signup_requires_invitation/i.test(raw)) {
      return 'That address has no live invitation. Ask the mentor for one.';
    }
    // GoTrue collapses any error raised by a trigger on auth.users into this one string, so
    // the invite check's own message often never reaches the browser. Name the likely cause
    // without asserting it — and deliberately do NOT add an "is this address invited?"
    // endpoint to find out, because that would be an enumeration oracle for who is in the
    // circle, which is the thing invite-only exists to protect.
    if (/database error saving new user/i.test(raw)) {
      return (
        'Your account could not be created. The most likely reason is that this address has ' +
        'no live invitation — check with the mentor that he used exactly this address.'
      );
    }
    if (/user already registered|already been registered/i.test(raw)) {
      return 'There is already an account for that address. Sign in instead, or reset your password.';
    }
    if (/rate limit|too many/i.test(raw)) return 'Too many attempts. Wait a minute and try again.';
    if (/row-level security|policy/i.test(raw)) return 'You do not have access to that.';
    return raw;
  }
  return 'Something went wrong. Try again.';
}
