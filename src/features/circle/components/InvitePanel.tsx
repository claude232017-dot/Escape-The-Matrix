import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { getSupabase } from '@/lib/supabase';
// From lib, not from features/auth: a feature importing another feature is the knot the
// import-graph test rejects, and email validation was never auth-specific.
import { isValidEmail, normaliseEmail } from '@/lib/email';
import { generateInvitationToken, invitationExpiry } from '@/features/circle/invite';

/**
 * The mentor's invitation list.
 *
 * Takes `circleId` and `isMentor` as **props** rather than reading the auth context, so
 * this feature does not import the auth feature. The composition root wires them together;
 * cross-feature imports are how a small app grows a knot nobody can refactor, and the
 * import-graph test rejects them.
 *
 * Hiding this panel from non-mentors is presentation only. What actually stops a member
 * creating invitations is the RLS policy requiring `app.is_mentor()`, tested in
 * tests/db/identity-rls.test.ts.
 */

interface Invitation {
  id: string;
  email: string;
  role: 'mentor' | 'member';
  expiresAt: string;
  acceptedAt: string | null;
}

export function InvitePanel({
  circleId,
  isMentor,
}: {
  circleId: string;
  isMentor: boolean;
}) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /** Pure fetch: no setState, so it is safe to call from an effect body. */
  const fetchInvitations = useCallback(async (): Promise<Invitation[]> => {
    const { data, error: queryError } = await getSupabase()
      .from('invitations')
      .select('id, email, role, expires_at, accepted_at')
      .order('created_at', { ascending: false });

    if (queryError) throw new Error(queryError.message);
    return (data ?? []).map((row) => ({
      id: row.id as string,
      email: row.email as string,
      role: row.role as 'mentor' | 'member',
      expiresAt: row.expires_at as string,
      acceptedAt: row.accepted_at as string | null,
    }));
  }, []);

  const load = useCallback(async () => {
    try {
      setInvitations(await fetchInvitations());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load invitations.');
    } finally {
      setLoaded(true);
    }
  }, [fetchInvitations]);

  useEffect(() => {
    if (!isMentor) return;
    // State is set from the promise callback, not synchronously in the effect body, and the
    // cancelled flag stops a late response overwriting fresher state after the panel has
    // been unmounted or the role has changed.
    let cancelled = false;
    fetchInvitations()
      .then((rows) => {
        if (!cancelled) setInvitations(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load invitations.');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isMentor, fetchInvitations]);

  if (!isMentor) return null;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!isValidEmail(email)) {
      setError('That does not look like an email address.');
      setBusy(false);
      return;
    }
    const { error: insertError } = await getSupabase().from('invitations').insert({
      circle_id: circleId,
      email: normaliseEmail(email),
      token: generateInvitationToken(),
      expires_at: invitationExpiry(),
    });
    if (insertError) {
      setError(
        /invitations_one_open_per_email/.test(insertError.message)
          ? 'That address already has a live invitation.'
          : insertError.message,
      );
    } else {
      setEmail('');
      await load();
    }
    setBusy(false);
  }

  async function onRevoke(id: string) {
    setBusy(true);
    const { error: deleteError } = await getSupabase().from('invitations').delete().eq('id', id);
    if (deleteError) setError(deleteError.message);
    await load();
    setBusy(false);
  }

  return (
    <section
      aria-labelledby="invitations-heading"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5"
    >
      <h2
        id="invitations-heading"
        className="text-xs font-semibold tracking-[0.18em] text-text-muted uppercase"
      >
        Invitations
      </h2>

      <form onSubmit={onInvite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" noValidate>
        <div className="flex-1">
          <Field
            label="Invite by email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
          />
        </div>
        <Button type="submit" disabled={busy || email.trim() === ''}>
          {busy ? 'Working…' : 'Invite'}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {error}
        </p>
      ) : null}

      <ul className="mt-5 flex flex-col gap-2">
        {loaded && invitations.length === 0 ? (
          <li className="text-sm text-text-muted">Nobody invited yet.</li>
        ) : null}
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-surface-base p-3"
          >
            <span className="min-w-0 break-all text-sm text-text-primary">{invitation.email}</span>
            <span className="flex items-center gap-3">
              <span
                className={`text-xs ${
                  invitation.acceptedAt ? 'text-status-pass' : 'text-text-muted'
                }`}
              >
                {invitation.acceptedAt ? 'joined' : 'pending'}
              </span>
              {invitation.acceptedAt ? null : (
                <Button
                  variant="quiet"
                  onClick={() => void onRevoke(invitation.id)}
                  disabled={busy}
                  aria-label={`Revoke the invitation for ${invitation.email}`}
                >
                  Revoke
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
