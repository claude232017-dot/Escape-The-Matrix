import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { useAuth } from '@/features/auth/AuthProvider';
import { firstError, validateEmail } from '@/features/auth/validation';
import { AuthShell, FormError } from '@/features/auth/components/AuthShell';

/**
 * Sign-in. **There is no signup form**, by design — membership comes from an invitation,
 * enforced by a trigger on auth.users, and a signup form would only offer a door that the
 * database refuses to open.
 */
export function SignInScreen() {
  const { signIn, requestPasswordReset, error, busy } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = firstError(validateEmail(email));
    if (problem) {
      setFieldError(problem.message);
      return;
    }
    setFieldError(null);
    await signIn(email, password);
  }

  async function onForgot() {
    const problem = validateEmail(email);
    if (problem) {
      setFieldError('Enter your email address first, then ask for a reset link.');
      return;
    }
    setFieldError(null);
    await requestPasswordReset(email);
    // Deliberately unconditional: saying "no account with that address" would let anyone
    // enumerate who is in the circle.
    setResetSent(true);
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Invite only. If you have not been given an invitation, there is nothing here for you yet."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
          required
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <FormError message={error} />

        {resetSent ? (
          <p className="text-sm text-text-secondary">
            If that address has an account, a reset link is on its way.
          </p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <Button variant="quiet" onClick={onForgot} disabled={busy}>
          Forgotten your password?
        </Button>
      </form>
    </AuthShell>
  );
}
