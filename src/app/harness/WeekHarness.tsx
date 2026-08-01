import { useCallback, useMemo, useState } from 'react';
import { MAX_COMMITMENTS, type Commitment } from '@/features/week/commitment-draft';
import { WeekForm, type WeekState } from '@/features/week/components/WeekForm';
import type { CircleCommitment } from '@/features/week/use-week-data';

/**
 * The week with fixture data and no network.
 *
 * Same purpose as the SITREP and Ledger harnesses. What it buys here specifically: the week's
 * behaviour is almost entirely *phase*-dependent — declare, live, settle, settled,
 * missed-the-week — and each phase is a different screen. Reaching them against a real database
 * would mean waiting for Sunday, so the day is a query parameter instead.
 *
 * `?today=` drives the phase. `?declared=` and `?last=` say what is already on the server.
 * Excluded from the production build by the same mechanism — see App.tsx and
 * tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-week-harness-fixture';

// 2026-07-27 is a Monday, 2026-08-02 the Sunday closing that week.
const THIS_MONDAY = '2026-07-27';
const LAST_MONDAY = '2026-07-20';

function commitments(count: number, weekStart: string, outcome: Commitment['outcome']) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${weekStart}-${String(i)}`,
    body: ['Ten sales calls', 'Ship the landing page', 'No alcohol'][i] ?? `Commitment ${String(i)}`,
    outcome,
    declaredOn: weekStart,
  }));
}

const FIXTURE_CIRCLE: CircleCommitment[] = [
  {
    id: 'peer-1',
    body: 'Twenty cold emails',
    outcome: 'pending',
    declaredOn: THIS_MONDAY,
    profileId: 'peer',
    displayName: 'Marcus',
  },
  {
    id: 'peer-2',
    body: 'Publish the case study',
    outcome: 'hit',
    declaredOn: THIS_MONDAY,
    profileId: 'peer',
    displayName: 'Marcus',
  },
  {
    id: 'peer-3',
    body: 'Three client calls',
    outcome: 'missed',
    declaredOn: THIS_MONDAY,
    profileId: 'peer-2',
    displayName: 'Dorian',
  },
];

export function WeekHarness() {
  const params = new URLSearchParams(window.location.search);
  const today = params.get('today') ?? THIS_MONDAY;
  const declared = Number(params.get('declared') ?? '0');
  // How many of last week's commitments are still unanswered.
  const lastPending = Number(params.get('last') ?? '0');

  const [drafts, setDrafts] = useState<string[]>(Array<string>(MAX_COMMITMENTS).fill(''));
  const [state, setState] = useState<WeekState>('idle');
  const [settled, setSettled] = useState<Record<string, 'hit' | 'missed'>>({});
  const [withdrawn, setWithdrawn] = useState<string[]>([]);

  const current = useMemo(
    () => ({
      weekStart: THIS_MONDAY,
      commitments: commitments(declared, THIS_MONDAY, 'pending').filter(
        (c) => !withdrawn.includes(c.id),
      ),
    }),
    [declared, withdrawn],
  );

  const previous = useMemo(
    () => ({
      weekStart: LAST_MONDAY,
      commitments: commitments(lastPending, LAST_MONDAY, 'pending').map((c) =>
        settled[c.id] ? { ...c, outcome: settled[c.id] as Commitment['outcome'] } : c,
      ),
    }),
    [lastPending, settled],
  );

  const onDraft = useCallback((index: number, value: string) => {
    setDrafts((prev) => prev.map((v, i) => (i === index ? value : v)));
    setState('idle');
  }, []);

  return (
    <div data-testid={HARNESS_MARKER} className="min-h-dvh bg-surface-void p-4 text-text-primary">
      <WeekForm
        current={current}
        previous={previous}
        circle={FIXTURE_CIRCLE}
        profileId="me"
        today={today}
        drafts={drafts}
        state={state}
        statusMessage={state === 'sent' ? 'Declared. It is on the server.' : 'Not declared yet.'}
        refusal={null}
        onDraft={onDraft}
        onDeclare={() => setState('sent')}
        onWithdraw={(id) => setWithdrawn((prev) => [...prev, id])}
        onSettle={(id, outcome) => setSettled((prev) => ({ ...prev, [id]: outcome }))}
      />
    </div>
  );
}
