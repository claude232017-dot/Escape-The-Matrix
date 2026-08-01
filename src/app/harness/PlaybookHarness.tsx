import { useMemo, useState } from 'react';
import { PlaybookList, PromoteForm } from '@/features/playbooks/components/PlaybookList';
import type { Application, Playbook, Transfer } from '@/features/playbooks/transfer';

/**
 * The playbook catalogue with fixture data and no network.
 *
 * What it buys that a unit test cannot: the verdict sentences are the whole feature, and the
 * one that matters most — "this looks personal to the man it came from" — only exists on a
 * rendered page. `?state=` selects which verdict each row is in, because reaching them against
 * a real database would mean four men adopting and answering.
 *
 * Excluded from the production build — see App.tsx and tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-playbook-harness-fixture';

const FIXTURE: Playbook[] = [
  {
    id: 'p-travels',
    title: 'Clothes out the night before',
    body: 'Lay the kit out before bed so the morning has no decision in it',
    protocolId: null,
    isActive: true,
    promotedFrom: 'd-1',
  },
  {
    id: 'p-personal',
    title: 'Cold shower at 05:00',
    body: 'Straight in, no negotiation, before the phone is touched',
    protocolId: null,
    isActive: true,
    promotedFrom: null,
  },
  {
    id: 'p-untested',
    title: 'Phone in another room',
    body: 'Charge it outside the bedroom so the first hour is yours',
    protocolId: null,
    isActive: true,
    promotedFrom: null,
  },
  {
    id: 'p-retired',
    title: 'Six alarms',
    body: 'Set six and let the last one win',
    protocolId: null,
    isActive: false,
    promotedFrom: null,
  },
];

const COUNTS: Transfer[] = [
  { playbookId: 'p-travels', adopted: 5, held: 4, didNot: 1, pending: 0 },
  { playbookId: 'p-personal', adopted: 5, held: 1, didNot: 4, pending: 0 },
  { playbookId: 'p-untested', adopted: 4, held: 1, didNot: 0, pending: 3 },
  { playbookId: 'p-retired', adopted: 0, held: 0, didNot: 0, pending: 0 },
];

export function PlaybookHarness() {
  const params = new URLSearchParams(window.location.search);
  const isMentor = params.get('mentor') === '1';
  const empty = params.get('empty') === '1';
  // Which of his own applications exist: none, one pending, one answered.
  const adopted = params.get('adopted') ?? 'none';

  const [answered, setAnswered] = useState<string | null>(null);
  const [abandoned, setAbandoned] = useState(false);

  const mine = useMemo<Application[]>(() => {
    if (abandoned || adopted === 'none') return [];
    const outcome =
      answered ?? (adopted === 'answered' ? 'held' : 'pending');
    return [
      {
        id: 'a-1',
        playbookId: 'p-travels',
        outcome: outcome as Application['outcome'],
        adoptedOn: '2026-07-27',
      },
    ];
  }, [adopted, answered, abandoned]);

  const transfer = useMemo(() => new Map(COUNTS.map((c) => [c.playbookId, c])), []);
  const playbooks = empty ? [] : FIXTURE;

  return (
    <div data-testid={HARNESS_MARKER} className="min-h-dvh bg-surface-void p-4 text-text-primary">
      <div className="flex flex-col gap-6">
        <PlaybookList
          playbooks={playbooks}
          order={playbooks.map((p) => p.id)}
          mine={mine}
          transfer={transfer}
          busy={false}
          refusal={null}
          onAdopt={() => undefined}
          onAnswer={(_id, outcome) => setAnswered(outcome)}
          onAbandon={() => setAbandoned(true)}
        />
        {isMentor ? (
          <PromoteForm busy={false} refusal={null} onPromote={() => undefined} />
        ) : null}
      </div>
    </div>
  );
}
