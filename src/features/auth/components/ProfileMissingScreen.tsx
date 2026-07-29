import { Button } from '@/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthShell } from '@/features/auth/components/AuthShell';

/**
 * Signed in, no profile row.
 *
 * This is the failure documented in docs/RUNBOOK.md: the `AFTER INSERT` trigger on
 * `auth.users` failed or is missing. It is named explicitly because the alternative is an
 * empty dashboard, and an empty dashboard is indistinguishable from "nothing has happened
 * yet" — which is how this gets misdiagnosed for a week.
 *
 * The member cannot fix it himself, so the screen does not pretend he can. It tells him
 * what is wrong in terms he can relay, and gives the mentor a searchable phrase.
 */
export function ProfileMissingScreen() {
  const { signOut, refreshProfile, session, busy } = useAuth();

  return (
    <AuthShell
      title="Your account is incomplete"
      subtitle="You are signed in, but your profile was never created. This is a fault on our side, not something you did wrong."
    >
      <div className="flex flex-col gap-4 text-sm text-text-secondary">
        <p>
          Send the mentor this exact phrase:{' '}
          <strong className="text-text-primary">&ldquo;signup trigger missing&rdquo;</strong>. It is
          in the runbook and takes a couple of minutes to fix. Nothing you have recorded is lost,
          because there is nothing recorded yet.
        </p>

        {session ? (
          <p className="text-xs text-text-muted">
            Account reference: <span data-numeral>{session.user.id}</span>
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button onClick={() => void refreshProfile()} disabled={busy}>
            {busy ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="quiet" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
