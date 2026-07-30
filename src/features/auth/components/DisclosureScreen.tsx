import { useState } from 'react';
import { Button } from '@/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthShell, FormError } from '@/features/auth/components/AuthShell';
import { DisclosureBody } from '@/features/auth/components/DisclosureBody';
import { DISCLOSURE_VERSION } from '@/features/auth/disclosure';

/**
 * What the mentor can see, said plainly, before the member files anything.
 *
 * This screen is the reason the mentor's access is legitimate rather than merely
 * configured (ADR-009). It blocks — there is no "later" — because a disclosure that can be
 * postponed is one a man discovers after he has already recorded a month of
 * special-category data about himself.
 *
 * The copy is deliberately concrete. "We take your privacy seriously" tells him nothing;
 * "the mentor sees which protocols you failed, including the sexual-discipline one" tells
 * him exactly what he is agreeing to.
 */

export function DisclosureScreen() {
  const { acceptDisclosure, signOut, profile, error, busy } = useAuth();
  const [confirmed, setConfirmed] = useState(false);

  // He has agreed to *something*, but not to this. SECURITY.md §3 requires re-consent when the
  // text materially changes, and the honest way to ask is to say what happened rather than
  // showing the same screen again as though he had never seen it.
  const reconsent = profile?.disclosureAcceptedAt != null;

  return (
    <AuthShell
      title={reconsent ? 'This has been updated' : 'Before you start'}
      subtitle={
        reconsent
          ? 'The disclosure has changed. Read it again — it describes who can see what you record.'
          : 'Read this once. It describes exactly who can see what you record.'
      }
    >
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-text-secondary">
        {reconsent ? (
          <p
            data-testid="disclosure-changed"
            className="rounded-[var(--radius-md)] border-l-2 border-status-med bg-surface-raised px-3 py-2 text-text-primary"
          >
            <strong>This has changed since you agreed to it.</strong> You accepted version{' '}
            <span data-numeral>{profile?.disclosureVersion}</span>; what follows is version{' '}
            <span data-numeral>{DISCLOSURE_VERSION}</span>. Read it again before continuing —
            consent to a different text is not consent to this one.
          </p>
        ) : null}

        <DisclosureBody />

        <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border-strong bg-surface-base p-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--colour-accent)]"
          />
          <span className="text-sm text-text-primary">
            I have read this and I understand the mentor sees my protocol detail in full.
          </span>
        </label>

        <FormError message={error} />

        <div className="flex flex-col gap-3">
          <Button
            onClick={() => void acceptDisclosure(DISCLOSURE_VERSION)}
            disabled={!confirmed || busy}
          >
            {busy ? 'Saving…' : 'I understand — continue'}
          </Button>
          <Button variant="quiet" onClick={() => void signOut()} disabled={busy}>
            Not now — sign out
          </Button>
        </div>

        {profile ? (
          <p className="text-xs text-text-muted">
            Signed in as {profile.displayName}. This will be recorded against version{' '}
            <span data-numeral>{DISCLOSURE_VERSION}</span>.
          </p>
        ) : null}
      </div>
    </AuthShell>
  );
}
