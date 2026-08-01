import { useId, useState } from 'react';
import { Button } from '@/ui/Button';

/**
 * Take your data, or be erased.
 *
 * Presentational, so the confirmation flow can be driven in a browser with no credentials —
 * which matters more here than anywhere else in the app, because this is the one screen where a
 * mis-wired button destroys a month of somebody's life.
 *
 * The two halves are deliberately not symmetrical. Export is one press: it is his data and
 * asking twice would be theatre. Deletion is behind a disclosure and then behind typing his own
 * address, because it cannot be undone and there is no support inbox to write to.
 */

export interface AccountPanelProps {
  email: string;
  busy: boolean;
  refusal: string | null;
  /** Set once an export has been handed to the browser, so the screen can say so. */
  exportedFilename: string | null;
  onExport: () => void;
  onDelete: (confirmEmail: string) => void;
}

export function AccountPanel({
  email,
  busy,
  refusal,
  exportedFilename,
  onExport,
  onDelete,
}: AccountPanelProps) {
  const confirmId = useId();
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState('');

  /**
   * Whether we know the address to confirm against.
   *
   * Supabase types `User.email` as `string | undefined`, and the shell passes `?? ''`. With an
   * empty address the old guard read `typed.trim().toLowerCase() !== ''`, which is **false for
   * an empty box** — so the erase button armed itself instantly, with nothing typed, on the one
   * control in this app that cannot be undone.
   *
   * The database still refused it, because it compares against the real address. But the whole
   * job of this screen is the distance between a stray tap and destruction, and that distance
   * had silently gone to zero.
   */
  const knowsAddress = email.trim() !== '';
  const confirmed = knowsAddress && typed.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <section
      aria-labelledby="account-heading"
      data-testid="account"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <h2
        id="account-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Your data
      </h2>

      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
        Everything this app holds about you, in one file — including the protocol detail and the
        Bottom G tactics that nobody but you and the mentor can see. It is yours; take it whenever
        you want it.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onExport} disabled={busy}>
          {busy ? 'Preparing…' : 'Export everything'}
        </Button>
        {exportedFilename ? (
          <p data-testid="export-done" aria-live="polite" className="text-xs text-text-muted">
            Downloaded as <span data-numeral>{exportedFilename}</span>.
          </p>
        ) : null}
      </div>

      <div className="mt-8 border-t border-border-subtle pt-6">
        <h3 className="text-sm font-semibold text-status-fail">Delete your account</h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-text-secondary">
          This erases every record of you: your reports, your debriefs, your ledger, your
          commitments. It is immediate and it cannot be undone — there is no backup anyone can
          restore you from, because keeping one would mean deletion did not mean deletion.
        </p>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-text-muted">
          Playbooks the circle adopted from you stay, with your name taken off them. Export first
          if you want a copy.
        </p>

        {!knowsAddress ? (
          // No address means no confirmation is possible, so deletion is not offered at all.
          // "Type  to confirm" is not a safeguard, it is a broken one.
          <p data-testid="delete-unavailable" className="mt-4 text-sm text-text-muted">
            Deletion needs the email address on your account, and this session does not carry
            one. Sign out and back in, then try again.
          </p>
        ) : !arming ? (
          <Button className="mt-4" variant="secondary" onClick={() => setArming(true)}>
            Delete my account
          </Button>
        ) : (
          <div data-testid="delete-confirm" className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={confirmId}
                className="text-xs font-semibold tracking-[0.14em] text-text-secondary uppercase"
              >
                Type <span className="normal-case">{email}</span> to confirm
              </label>
              <input
                id={confirmId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="min-h-11 rounded-[var(--radius-md)] border border-status-fail bg-surface-base px-3 text-base text-text-primary"
              />
            </div>

            {refusal ? (
              <p role="alert" className="text-sm text-status-fail">
                {refusal}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {/* Disabled until it matches, and the database checks it again regardless — the
                  browser half is a courtesy, not the rule (§3.3). */}
              <Button onClick={() => onDelete(typed)} disabled={busy || !confirmed}>
                {busy ? 'Deleting…' : 'Erase everything'}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setArming(false);
                  setTyped('');
                }}
                disabled={busy}
              >
                Keep my account
              </Button>
            </div>
          </div>
        )}
      </div>

      {refusal && !arming ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {refusal}
        </p>
      ) : null}
    </section>
  );
}
