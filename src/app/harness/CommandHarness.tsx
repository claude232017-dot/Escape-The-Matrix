import { useMemo } from 'react';
import { addDays } from '@/lib/date';
import { CommanderScreen } from '@/features/command/components/CommanderScreen';
import type { MemberDay, Standing } from '@/features/command/correlation';
import type { CommandData } from '@/features/command/use-command-data';

/**
 * The Commander's View with fixture data and no network.
 *
 * Same purpose as the other three harnesses, and one specific to this screen: the correlation
 * has a hard evidence threshold, so the interesting states are *below* it and *above* it. Both
 * need a month of days on either side of a five-day minimum, which is not something a browser
 * test can create by clicking, and not something a real database would have on demand.
 *
 * `?days=` builds a run of held days, `?broken=` a run of reset ones, and `?flag=` puts men on
 * the attention list. Excluded from the production build by the same mechanism — see App.tsx and
 * tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-command-harness-fixture';

/** A Monday, so the weekly rollup lands on clean boundaries. */
const FIXTURE_START = '2026-07-06';

function run(
  count: number,
  status: MemberDay['finalStatus'],
  blocks: number,
  offset: number,
): MemberDay[] {
  // Walked with addDays rather than through a Date. The ESLint rule banning a calendar date
  // sliced out of toISOString() applies here too — a harness that generated its fixture dates
  // in UTC would be quietly testing the very bug §3.1 exists to prevent.
  return Array.from({ length: count }, (_, i) => {
    return {
      profileId: 'me',
      localDate: addDays(FIXTURE_START, offset + i),
      finalStatus: status,
      deepWorkBlocks: blocks,
      businessActions: blocks * 2,
      // One payment on the first day of the run, so the weekly table has something in it.
      revenueMinor: i === 0 ? '125000' : '0',
      currency: i === 0 ? 'GBP' : null,
      currencyCount: i === 0 ? 1 : 0,
    };
  });
}

export function CommandHarness() {
  const params = new URLSearchParams(window.location.search);
  const heldDays = Number(params.get('days') ?? '0');
  const brokenDays = Number(params.get('broken') ?? '0');
  const flagged = params.get('flag') === '1';
  const isMentor = params.get('mentor') !== '0';
  const directed = params.get('directive') === '1';

  const data = useMemo<CommandData>(() => {
    const mine = [...run(heldDays, 'complete', 4, 0), ...run(brokenDays, 'reset', 1, heldDays)];

    const standings: Standing[] = [
      {
        profileId: 'me',
        displayName: 'Aurelius',
        lastReported: '2026-07-30',
        daysSilent: 0,
        daysHeld: heldDays,
        daysReset: brokenDays,
        commitmentsPending: 0,
      },
      {
        profileId: 'peer-1',
        displayName: 'Marcus',
        lastReported: flagged ? '2026-07-24' : '2026-07-30',
        daysSilent: flagged ? 6 : 0,
        daysHeld: 12,
        daysReset: 0,
        commitmentsPending: 0,
      },
      {
        profileId: 'peer-2',
        displayName: 'Dorian',
        lastReported: '2026-07-30',
        daysSilent: 0,
        daysHeld: 9,
        daysReset: flagged ? 1 : 0,
        commitmentsPending: flagged ? 2 : 0,
      },
    ];

    return {
      loaded: {
        mine,
        circle: mine,
        standings,
        directives: directed
          ? [
              {
                id: 'd-1',
                authorId: 'mentor',
                subjectId: 'me',
                weekStart: '2026-07-27',
                body: 'Ten offers before Friday. No exceptions.',
              },
            ]
          : [],
      },
      error: null,
      localDate: '2026-07-31',
      reload: () => undefined,
    };
  }, [heldDays, brokenDays, flagged, directed]);

  return (
    <div data-testid={HARNESS_MARKER} className="min-h-dvh bg-surface-void p-4 text-text-primary">
      <CommanderScreen data={data} isMentor={isMentor} profileId="me" />
    </div>
  );
}
