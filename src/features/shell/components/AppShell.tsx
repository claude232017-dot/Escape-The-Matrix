import { PHASE, PHASE_LABEL } from '@/app/build-info';

/**
 * Phase 0 shell.
 *
 * Deliberately inert: it renders the frame, proves the token pipeline reaches the
 * browser, and gives the browser tests something with real landmarks and a real
 * accessible name to assert against. No data, no auth, no network — those arrive in
 * Phase 1.
 */
export function AppShell() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="min-h-dvh bg-surface-void text-text-primary">
        <header className="border-b border-border-subtle">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-4 sm:px-6">
            <h1 className="text-sm font-semibold tracking-[0.2em] text-text-primary uppercase">
              Escape The Matrix
            </h1>
            <p className="text-xs text-text-muted">Private. Invite only.</p>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
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

            <p className="mt-3 text-2xl text-text-primary">
              <span data-numeral className="text-accent">
                Phase {PHASE}
              </span>{' '}
              <span className="text-text-secondary">— {PHASE_LABEL}</span>
            </p>

            <p className="mt-4 max-w-prose text-sm leading-relaxed text-text-secondary">
              Foundation only. Local-date and money primitives, the measured colour
              palette, migrations and CI are in place. The Forge and the Ledger are not
              built yet.
            </p>

            <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Fact term="Dates" detail="Resolved in the member's own timezone" />
              <Fact term="Money" detail="Integer minor units, never a float" />
              <Fact term="Access" detail="Enforced in the database, not the browser" />
            </dl>
          </section>
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
