import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  firstError,
  PASSWORD_MIN_LENGTH,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateTimezone,
} from '@/features/auth/validation';
import { guessTimezone, timezoneLabel, timezoneOptions } from '@/features/auth/timezone-options';
import { AuthShell, FormError } from '@/features/auth/components/AuthShell';

/**
 * First-time setup for an invited man.
 *
 * This is a signup form, and it is safe to expose **precisely because** the invite check is a
 * `BEFORE INSERT` trigger on `auth.users` that raises. The gate is in the database; this form
 * only reaches it. That is the whole reason the trigger was built to raise rather than to log.
 *
 * It deliberately does not tell an uninvited person that they are uninvited with certainty,
 * and there is no "is this address invited?" endpoint behind it — that would be an
 * enumeration oracle for who is in the circle, which is the thing invite-only protects.
 *
 * The timezone is captured **here**, at the only moment it can be captured before it starts
 * mattering: every day count, week boundary and SITREP deadline this man will ever have is
 * measured against it.
 */
export function FirstTimeSetupScreen({ onUseSignIn }: { onUseSignIn: () => void }) {
  const { signUpWithInvitation, error, busy } = useAuth();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [timezone, setTimezone] = useState(() => guessTimezone());
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const zones = useMemo(() => timezoneOptions(), []);
  const zoneLabels = useMemo(
    () => new Map(zones.map((zone) => [zone, timezoneLabel(zone)])),
    [zones],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = firstError(
      validateEmail(email),
      validateDisplayName(displayName),
      validateTimezone(timezone),
      validatePassword(password),
      validatePasswordConfirmation(password, confirmation),
    );
    if (problem) {
      setFieldError(problem);
      return;
    }
    setFieldError(null);
    try {
      const { needsEmailConfirmation } = await signUpWithInvitation({
        email,
        password,
        displayName,
        timezone,
      });
      // When GoTrue auto-confirms, a session already exists and the gate has moved us on;
      // this screen only needs to say something in the other case.
      if (needsEmailConfirmation) setAwaitingConfirmation(true);
    } catch {
      // The provider has set a displayable error. Keep the form on screen with the values
      // intact so a corrected address does not mean retyping everything.
    }
  }

  if (awaitingConfirmation) {
    return (
      <AuthShell title="Check your email" subtitle="Your account is created but not yet confirmed.">
        <div className="flex flex-col gap-4 text-sm text-text-secondary">
          <p>
            We sent a confirmation link to{' '}
            <strong className="text-text-primary break-all">{email.trim().toLowerCase()}</strong>.
            Open it, then come back and sign in.
          </p>
          <Button variant="secondary" onClick={onUseSignIn}>
            Back to sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : null);

  return (
    <AuthShell
      title="First time here"
      subtitle="Use the exact email address your invitation was sent to. Anything else will be turned away."
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
          error={errorFor('email')}
          required
        />
        <Field
          label="Name"
          name="name"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint="What the circle will see."
          error={errorFor('displayName')}
          required
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="setup-timezone"
            className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
          >
            Timezone
          </label>
          <select
            id="setup-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="setup-timezone-hint"
            className="min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-base text-text-primary"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zoneLabels.get(zone) ?? zone}
              </option>
            ))}
          </select>
          <p id="setup-timezone-hint" className="text-xs text-text-muted">
            Your day rolls over at midnight here. Check it — a laptop still on holiday time
            will have guessed wrong.
          </p>
        </div>

        <Field
          label="Password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Length beats punctuation.`}
          error={errorFor('password')}
          required
        />
        <Field
          label="Confirm password"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          error={errorFor('passwordConfirmation')}
          required
        />

        <FormError message={error} />

        <Button type="submit" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create my account'}
        </Button>
        <Button variant="quiet" onClick={onUseSignIn} disabled={busy}>
          I already have an account
        </Button>
      </form>
    </AuthShell>
  );
}
