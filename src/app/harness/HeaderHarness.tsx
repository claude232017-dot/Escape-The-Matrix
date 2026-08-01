import { CampaignHeader } from '@/app/CampaignHeader';
import { MatrixRain } from '@/app/MatrixRain';

/**
 * The campaign header, and the rain, with no session.
 *
 * Two things that had no test between them.
 *
 * The header renders only inside `SignedInShell`, which needs a real session, so for nine
 * phases the most-seen element in the application — the one that answers "where am I in this"
 * before anything else — was reachable by no suite at all. Its layout was reasoned about and
 * never measured.
 *
 * The rain is here for the opposite reason: to prove where it is **not**. A spec that only ever
 * loads the sign-in screen cannot tell the difference between "the rain is confined to the
 * threshold" and "the rain happens to be on the one screen we looked at". `?rain=1` puts it
 * behind this header deliberately, so the assertion that no *application* screen carries it is
 * made against a harness that demonstrably can.
 *
 * Excluded from the production build — see App.tsx and tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-header-harness-fixture';

function integerParam(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function HeaderHarness() {
  const params = new URLSearchParams(window.location.search);

  // `?day=none` is the pre-enrolment state, which is a different render rather than day zero.
  const dayParam = params.get('day');
  const day = dayParam === 'none' ? null : integerParam(params, 'day', 22);

  return (
    <div data-testid={HARNESS_MARKER} className="min-h-dvh bg-surface-void text-text-primary">
      {params.get('rain') === '1' ? <MatrixRain /> : null}
      <CampaignHeader
        day={day}
        lengthDays={integerParam(params, 'length', 30)}
        campaignName={params.get('campaign') ?? 'Escape The Matrix'}
        memberName={params.get('member') ?? 'Member A'}
        isMentor={params.get('mentor') === '1'}
        streak={integerParam(params, 'streak', 6)}
        filedToday={params.get('filed') === '1'}
      />
      <main id="main" className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
        <p className="text-sm text-text-secondary">Fixture body copy beneath the header.</p>
      </main>
    </div>
  );
}
