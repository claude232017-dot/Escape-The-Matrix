import { useCallback, useMemo, useState } from 'react';
import { parseMoney, type CurrencyCode } from '@/lib/money';
import {
  CATEGORY_DIRECTION,
  setCount,
  toMoneyPayload,
  toPayload,
  type BusinessAction,
  type CountDraft,
  type MoneyCategory,
  type MoneyEntry,
  type Venture,
} from '@/features/ledger/ledger-draft';
import { LedgerForm, type LedgerState } from '@/features/ledger/components/LedgerForm';

/**
 * The Ledger with fixture data and no network.
 *
 * Same purpose as the SITREP harness: the money rules and the count rules are only observable in
 * a rendered screen, and a browser test cannot create a venture, a catalogue and a month of
 * entries without shipping credentials.
 *
 * Excluded from the production build by the same mechanism — see App.tsx and
 * tests/unit/harness-excluded.test.ts.
 */

const HARNESS_MARKER = 'etm-ledger-harness-fixture';

const FIXTURE_ACTIONS: BusinessAction[] = [
  { id: 'a-offers', slug: 'offers-made', label: 'Offers made', unit: 'offers', hint: 'A specific ask for money for a specific thing.', sortOrder: 10 },
  { id: 'a-convos', slug: 'conversations-held', label: 'Conversations held', unit: 'conversations', hint: null, sortOrder: 20 },
  { id: 'a-follow', slug: 'follow-ups-sent', label: 'Follow-ups sent', unit: 'follow-ups', hint: null, sortOrder: 30 },
  { id: 'a-deep', slug: 'deep-work-blocks', label: 'Deep work blocks', unit: '25-min blocks', hint: 'The bridge between the Forge and the Ledger.', sortOrder: 40 },
  { id: 'a-assets', slug: 'assets-shipped', label: 'Assets shipped', unit: 'assets', hint: null, sortOrder: 50 },
  { id: 'a-payments', slug: 'payments-collected', label: 'Payments collected', unit: 'payments', hint: null, sortOrder: 60 },
];

const FIXTURE_VENTURES: Venture[] = [
  { id: 'v-1', name: 'Consultancy', kind: 'B2B services', status: 'active', startedOn: '2026-07-01' },
  { id: 'v-2', name: 'Course', kind: 'Digital product', status: 'active', startedOn: '2026-07-10' },
];

function fixtureMoney(count: number): MoneyEntry[] {
  const shape: MoneyEntry[] = [
    { id: 'm1', ventureId: 'v-1', occurredOn: '2026-07-30', direction: 'in', amount: parseMoney('1250.00', 'GBP'), category: 'sale', isRecurring: false, note: 'Retainer' },
    { id: 'm2', ventureId: 'v-1', occurredOn: '2026-07-28', direction: 'out', amount: parseMoney('400.00', 'GBP'), category: 'advertising', isRecurring: false, note: null },
    { id: 'm3', ventureId: 'v-1', occurredOn: '2026-07-25', direction: 'in', amount: parseMoney('0.10', 'GBP'), category: 'sale', isRecurring: false, note: null },
    { id: 'm4', ventureId: 'v-1', occurredOn: '2026-07-24', direction: 'in', amount: parseMoney('0.20', 'GBP'), category: 'sale', isRecurring: false, note: null },
    { id: 'm5', ventureId: 'v-1', occurredOn: '2026-07-20', direction: 'in', amount: parseMoney('500.00', 'USD'), category: 'sale', isRecurring: false, note: 'Other currency' },
  ];
  return shape.slice(0, Math.min(count, shape.length));
}

function numberFromUrl(name: string, fallback: number): number {
  const raw = new URLSearchParams(window.location.search).get(name);
  const parsed = raw === null ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function LedgerHarness() {
  const money = useMemo(() => fixtureMoney(numberFromUrl('money', 5)), []);
  const ventures = useMemo(
    () => FIXTURE_VENTURES.slice(0, Math.max(1, numberFromUrl('ventures', 2))),
    [],
  );

  const [ventureId, setVentureId] = useState('v-1');
  const [counts, setCounts] = useState<CountDraft>({});
  const [state, setState] = useState<LedgerState>('idle');
  const [filed, setFiled] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const onCount = useCallback((actionId: string, count: number) => {
    setCounts((current) => setCount(current, actionId, count));
    setState('idle');
  }, []);

  const onFile = useCallback(() => {
    const payload = toPayload(ventureId, '2026-07-30', counts);
    setFiled(payload ? JSON.stringify(payload) : null);
    setState(payload ? 'sent' : 'idle');
  }, [counts, ventureId]);

  const onMoney = useCallback(
    (input: {
      amount: string;
      currency: CurrencyCode;
      category: MoneyCategory;
      isRecurring: boolean;
      note: string;
    }) => {
      setBooked(
        JSON.stringify(
          toMoneyPayload({
            id: 'harness-money',
            ventureId,
            occurredOn: '2026-07-30',
            direction: CATEGORY_DIRECTION[input.category],
            amount: parseMoney(input.amount, input.currency),
            category: input.category,
            isRecurring: input.isRecurring,
            note: input.note.trim() === '' ? null : input.note.trim(),
          }),
        ),
      );
    },
    [ventureId],
  );

  return (
    <div className="min-h-dvh bg-surface-void" data-harness={HARNESS_MARKER}>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <LedgerForm
          ventures={ventures}
          actions={FIXTURE_ACTIONS}
          ventureId={ventureId}
          counts={counts}
          money={money}
          unreadableMoney={numberFromUrl('unreadable', 0)}
          localDate="2026-07-30"
          state={state}
          statusMessage={state === 'sent' ? 'Recorded. It is on the server.' : 'Not recorded yet.'}
          refusal={null}
          alreadyFiled={false}
          onVenture={setVentureId}
          onCount={onCount}
          onFile={onFile}
          onMoney={onMoney}
          onNewVenture={() => undefined}
        />
        <pre data-testid="filed-ledger" className="sr-only">
          {filed ?? ''}
        </pre>
        <pre data-testid="booked-money" className="sr-only">
          {booked ?? ''}
        </pre>
      </main>
    </div>
  );
}
