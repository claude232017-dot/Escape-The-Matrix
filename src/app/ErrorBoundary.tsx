import { Component, type ErrorInfo, type ReactNode } from 'react';
import { describeCrash } from '@/app/crash-report';
import { report } from '@/lib/egress';

/**
 * The last line before a white page.
 *
 * React unmounts the whole tree when a render throws, so without this the app becomes a blank
 * document with nothing in it — no message, no way out, and nothing for the person to relay.
 * "The app is broken" is where that conversation starts and ends.
 *
 * A class component because `componentDidCatch` has no hook equivalent.
 *
 * What it deliberately does not do: report anywhere. Any future error reporter must not
 * receive protocol detail (docs/SECURITY.md §2), and a boundary that captures arbitrary
 * component state is the easiest place in the codebase to leak it by accident. Adding one is a
 * Phase 9 job with a scrubbing test attached, not a convenience to bolt on here.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only place the component stack survives, and it is what turns "it
    // broke" into a file and a line.
    // Everything, on his own device: this is what turns "it says the server gave no reason"
    // into a diagnosis, it is his own data, and §3.5 is about third parties.
    console.error('[crash]', error, info.componentStack);

    // And the scrubbed shape, through the one door a reporter may ever be wired to. Nothing is
    // sent today — see lib/egress.ts — but the call site exists so that adding one is a change
    // inside that function rather than a vendor SDK dropped into a component.
    report(error, {
      pathname: typeof window === 'undefined' ? '/' : window.location.pathname,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;

    const report = describeCrash(this.state.error);

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-void px-4 py-10">
        <div className="w-full max-w-sm">
          <p className="mb-8 text-xs font-semibold tracking-[0.2em] text-text-muted uppercase">
            Escape The Matrix
          </p>
          <main
            role="alert"
            className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5 sm:p-6"
          >
            <h1 className="text-lg font-semibold text-text-primary">{report.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">{report.detail}</p>

            {/* Shown, not hidden behind a toggle. It is the one thing that makes the report
                actionable, and a man who has just lost his screen should not have to go
                looking for it. */}
            <p className="mt-4 rounded-[var(--radius-md)] border border-border-subtle bg-surface-sunken p-3 text-xs break-words text-text-muted">
              <span data-numeral>{report.technical}</span>
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold tracking-wide text-accent-ink hover:bg-accent-strong"
            >
              Reload
            </button>
          </main>
        </div>
      </div>
    );
  }
}
