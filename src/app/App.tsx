import { Suspense, lazy } from 'react';
import { Motion } from '@/app/Motion';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { AuthGate } from '@/features/auth/components/AuthGate';
import { SignedInShell } from '@/app/SignedInShell';

/**
 * Composition root.
 *
 * The boundary is outermost so that a throw anywhere — including inside the auth provider,
 * which is where a bad session or a malformed profile row would surface — still produces a
 * screen with words on it rather than a blank document.
 *
 * `AuthGate` is the only thing that can render `SignedInShell`, from exactly one branch of an
 * exhaustive switch. Nothing below the gate needs to re-check whether a session exists.
 */

/**
 * The test harness, and why it cannot leak into production.
 *
 * `import.meta.env.VITE_TEST_HARNESS` is inlined by Vite as a **literal** at build time, so in a
 * normal build the comparison is statically false. Rollup drops the branch and — because the
 * import is dynamic — the harness module and its fixtures are never emitted at all. That is the
 * mechanism; tests/browser/sitrep.spec.ts is the proof, asserting the route is dead in the
 * production build rather than trusting the reasoning.
 *
 * It matters because the harness renders an application screen with **no authentication**. A gate
 * that were only a runtime check would be a way to reach the Forge without a session.
 */
const HARNESS_ENABLED = import.meta.env.VITE_TEST_HARNESS === '1';
const SITREP_HARNESS_PATH = '/harness/sitrep';
const LEDGER_HARNESS_PATH = '/harness/ledger';
const WEEK_HARNESS_PATH = '/harness/week';
const COMMAND_HARNESS_PATH = '/harness/command';
const PLAYBOOK_HARNESS_PATH = '/harness/playbooks';

const SitrepHarness = HARNESS_ENABLED
  ? lazy(() =>
      import('@/app/harness/SitrepHarness').then((module) => ({ default: module.SitrepHarness })),
    )
  : null;

const LedgerHarness = HARNESS_ENABLED
  ? lazy(() =>
      import('@/app/harness/LedgerHarness').then((module) => ({ default: module.LedgerHarness })),
    )
  : null;

const WeekHarness = HARNESS_ENABLED
  ? lazy(() =>
      import('@/app/harness/WeekHarness').then((module) => ({ default: module.WeekHarness })),
    )
  : null;

const CommandHarness = HARNESS_ENABLED
  ? lazy(() =>
      import('@/app/harness/CommandHarness').then((module) => ({ default: module.CommandHarness })),
    )
  : null;

const PlaybookHarness = HARNESS_ENABLED
  ? lazy(() =>
      import('@/app/harness/PlaybookHarness').then((m) => ({ default: m.PlaybookHarness })),
    )
  : null;

export function App() {
  if (
    HARNESS_ENABLED &&
    SitrepHarness &&
    LedgerHarness &&
    WeekHarness &&
    CommandHarness &&
    PlaybookHarness
  ) {
    const path = window.location.pathname;
    const Harness =
      path === SITREP_HARNESS_PATH
        ? SitrepHarness
        : path === LEDGER_HARNESS_PATH
          ? LedgerHarness
          : path === WEEK_HARNESS_PATH
            ? WeekHarness
            : path === COMMAND_HARNESS_PATH
              ? CommandHarness
              : path === PLAYBOOK_HARNESS_PATH
                ? PlaybookHarness
                : null;
    if (Harness) {
      return (
        <ErrorBoundary>
          <Motion>
            <Suspense fallback={<p className="p-4 text-sm text-text-muted">Loading harness…</p>}>
              <Harness />
            </Suspense>
          </Motion>
        </ErrorBoundary>
      );
    }
  }

  return (
    <ErrorBoundary>
      <Motion>
        <AuthProvider>
          <AuthGate>
            <SignedInShell />
          </AuthGate>
        </AuthProvider>
      </Motion>
    </ErrorBoundary>
  );
}
