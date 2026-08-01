import { useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import {
  PASSWORD_MIN_LENGTH,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth/validation';
import { firstError } from '@/lib/field-validation';
import { AuthShell, FormError } from '@/features/auth/components/AuthShell';

/**
 * The full-screen password reset.
 *
 * Held from first paint whenever a recovery link is in play, and there is **no way out of
 * this screen except setting a password**. That is the point: the recovery link has already
 * produced a real session, so any route out of here — a "back to app" link, a dismissible
 * banner — turns the email into a standing credential for whoever can read it.
 *
 * Sign-out is offered because abandoning the reset must be possible; it ends the session
 * rather than navigating past it.
 */
export function ResetPasswordScreen() {
  const { completePasswordReset, signOut, error, busy } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = firstError(
      validatePassword(password),
      validatePasswordConfirmation(password, confirmation),
    );
    if (problem) {
      setFieldError(problem.message);
      return;
    }
    setFieldError(null);
    try {
      await completePasswordReset(password);
      setDone(true);
    } catch {
      // The provider has already set a displayable error; keep the form on screen so the
      // person can retry rather than being left on a dead end.
    }
  }

  if (done) {
    return (
      <AuthShell title="Password set" subtitle="You can carry on.">
        <p className="text-sm text-text-secondary">
          Your password has been changed and this link is now spent.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="This link signed you in for one purpose only. Set a password to continue."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Length beats punctuation.`}
          error={fieldError}
          required
          autoFocus
        />
        <Field
          label="Confirm password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          required
        />

        <FormError message={error} />

        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set password'}
        </Button>

        <Button variant="quiet" onClick={() => void signOut()} disabled={busy}>
          Cancel and sign out
        </Button>
      </form>
    </AuthShell>
  );
}
