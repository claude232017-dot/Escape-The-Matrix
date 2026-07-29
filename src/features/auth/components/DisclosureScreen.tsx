import { useState } from 'react';
import { Button } from '@/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { AuthShell, FormError } from '@/features/auth/components/AuthShell';
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

  return (
    <AuthShell
      title="Before you start"
      subtitle="Read this once. It describes exactly who can see what you record."
    >
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-text-secondary">
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
            What the mentor sees
          </h2>
          <p>
            <strong className="text-text-primary">Everything you record, itemised.</strong> Which
            protocols you passed, which you passed at MED, and which you failed — including the
            sexual-discipline protocol and the ones covering alcohol and drugs. He also sees your
            debriefs, your commitments and your revenue.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
            What the other men see
          </h2>
          <p>
            Whether you filed, whether your day held, your weekly commitments and whether you hit
            them. <strong className="text-text-primary">Not</strong> which specific protocol you
            failed. The sensitive ones count toward your day&rsquo;s status and are never itemised
            to your peers.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-text-primary uppercase">
            What nobody outside sees
          </h2>
          <p>
            No analytics service, error reporter or log aggregator ever receives protocol detail.
            Your data is exportable and deletable on request, and deletion means deletion.
          </p>
        </section>

        <p className="text-text-muted">
          This only works if what you record is true. If you would rather not have the mentor see a
          particular protocol itemised, say so to him directly — do not solve it by filing a
          report that is not accurate.
        </p>

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
