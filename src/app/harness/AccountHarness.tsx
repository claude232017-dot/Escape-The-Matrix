import { useState } from 'react';
import { AccountPanel } from '@/features/account/components/AccountPanel';

/**
 * The account panel with fixture state and no network.
 *
 * This is the one screen in the app where a mis-wired control is unrecoverable, so it gets the
 * same treatment as the rest: driven in a real browser, with the confirmation flow exercised
 * rather than reasoned about.
 *
 * Nothing here calls the real RPCs. `onDelete` records what it was given, so the spec can assert
 * the button hands over exactly what the man typed — the database compares it against his
 * address, and passing the wrong thing would refuse a deletion he meant or, far worse, look
 * like it succeeded.
 *
 * Excluded from the production build — see App.tsx and tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-account-harness-fixture';
const EMAIL = 'member-a@example.com';

export function AccountHarness() {
  const params = new URLSearchParams(window.location.search);
  const refusal = params.get('refused') === '1' ? 'That is not the address on this account.' : null;
  // `?noemail=1` reproduces a session whose user carries no address — Supabase types
  // User.email as string | undefined, and the shell passes `?? ''`.
  const email = params.get('noemail') === '1' ? '' : EMAIL;

  const [exported, setExported] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  return (
    <div data-testid={HARNESS_MARKER} className="min-h-dvh bg-surface-void p-4 text-text-primary">
      <AccountPanel
        email={email}
        busy={false}
        refusal={refusal}
        exportedFilename={exported}
        onExport={() => setExported('escape-the-matrix-2026-08-01.json')}
        onDelete={(confirmEmail) => setSent(confirmEmail)}
      />
      {/* What the panel actually handed over, so the spec can check it rather than trust it. */}
      <p data-testid="delete-sent">{sent ?? ''}</p>
    </div>
  );
}
