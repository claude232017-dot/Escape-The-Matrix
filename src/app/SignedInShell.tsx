import { useState } from 'react';
import { PHASE, PHASE_LABEL } from '@/app/build-info';
import { useAuth } from '@/features/auth/AuthProvider';
import { InvitePanel } from '@/features/circle/components/InvitePanel';
import { ProfileScreen } from '@/features/profile/components/ProfileScreen';
import { Button } from '@/ui/Button';

/**
 * What a signed-in member sees.
 *
 * Lives in `app` rather than in a feature because it is the wiring: it reads the session from
 * the auth feature and passes plain values down to the circle and profile features, so none of
 * them import each other.
 *
 * Phase 1 has no Forge and no Ledger, so this is honest about what is missing rather than
 * showing empty widgets that imply the data is merely absent.
 */
export function SignedInShell() {
  const { profile, signOut, refreshProfile, busy } = useAuth();
  const [editingProfile, setEditingProfile] = useState(false);

  if (!profile) return null; // Unreachable: AuthGate only renders this in the 'app' view.

  const needsSetup = profile.topGCode === null;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="min-h-dvh bg-surface-void text-text-primary">
        <header className="border-b border-border-subtle">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-sm font-semibold tracking-[0.2em] text-text-primary uppercase">
                Escape The Matrix
              </h1>
              <p className="text-xs text-text-muted">
                {profile.displayName}
                {profile.role === 'mentor' ? ' · mentor' : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setEditingProfile((open) => !open)}
                aria-expanded={editingProfile}
              >
                {editingProfile ? 'Hide profile' : 'Profile'}
              </Button>
              <Button variant="secondary" onClick={() => void signOut()} disabled={busy}>
                Sign out
              </Button>
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
          {/* Prompted rather than nagged, and only once there is a real reason: the Morning
              Protocol cannot show him a Code he has not written. */}
          {needsSetup && !editingProfile ? (
            <section className="rounded-[var(--radius-lg)] border border-border-strong bg-surface-raised p-5">
              <h2 className="text-sm font-semibold text-text-primary">
                Write your Top G Code before the Forge opens
              </h2>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
                The Morning Protocol reads it back to you at the moment it asks you to say it
                aloud. Without it, that protocol has nothing to show.
              </p>
              <Button className="mt-4" onClick={() => setEditingProfile(true)}>
                Write it now
              </Button>
            </section>
          ) : null}

          {editingProfile ? (
            <ProfileScreen
              profileId={profile.id}
              initial={{
                displayName: profile.displayName,
                timezone: profile.timezone,
                topGCode: profile.topGCode,
                commandPostNote: profile.commandPostNote,
                fortressProtocol: profile.fortressProtocol,
              }}
              onSaved={refreshProfile}
              onClose={() => setEditingProfile(false)}
            />
          ) : null}

          <section
            aria-labelledby="status-heading"
            className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5 sm:p-6"
          >
            <h2
              id="status-heading"
              className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
            >
              Build status
            </h2>
            <p className="mt-3 text-2xl">
              <span data-numeral className="text-accent">
                Phase {PHASE}
              </span>{' '}
              <span className="text-text-secondary">— {PHASE_LABEL}</span>
            </p>
            <p className="mt-4 max-w-prose text-sm leading-relaxed text-text-secondary">
              Identity and invitations are live. The Forge — protocols, the MED and the daily
              SITREP — is not built yet, so there is nothing to report against.
            </p>
            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Fact term="Your timezone" detail={profile.timezone} />
              <Fact
                term="Disclosure"
                detail={
                  profile.disclosureVersion
                    ? `Accepted, version ${profile.disclosureVersion}`
                    : 'Not accepted'
                }
              />
            </dl>
          </section>

          {/* isMentor is presentation only. What stops a member creating invitations is the
              RLS policy requiring app.is_mentor(). */}
          <InvitePanel circleId={profile.circleId} isMentor={profile.role === 'mentor'} />
        </main>

        <footer className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
          <p className="text-xs text-text-muted">
            Built for a closed circle. Not a product, not a funnel.
          </p>
        </footer>
      </div>
    </>
  );
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface-base p-4">
      <dt className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">{term}</dt>
      <dd className="mt-1 text-sm text-text-secondary">{detail}</dd>
    </div>
  );
}
