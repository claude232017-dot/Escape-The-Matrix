import { useCallback, useRef, useState, type ReactNode } from 'react';
import { parseMoney, type CurrencyCode } from '@/lib/money';
import type { OutboxEntry } from '@/lib/outbox';
import { getSupabase } from '@/lib/supabase';
import { describeQueue, useOutbox } from '@/lib/use-outbox';
import {
  businessDayKey,
  moneyKey,
  setCount,
  toMoneyPayload,
  toPayload,
  type BusinessDayPayload,
  type CountDraft,
  type MoneyCategory,
  type MoneyPayload,
} from '@/features/ledger/ledger-draft';
import { CATEGORY_DIRECTION } from '@/features/ledger/ledger-draft';
import { ledgerRefusalMessage, sendBusinessDay, sendMoneyEntry } from '@/features/ledger/ledger-write';
import { LedgerForm, type LedgerState } from '@/features/ledger/components/LedgerForm';
import type { LedgerData, LedgerLoaded } from '@/features/ledger/use-ledger-data';
import { Button } from '@/ui/Button';

/**
 * The Ledger, wired to the database.
 *
 * Takes its data as a prop — loaded once by the shell, per the lesson in
 * @/features/forge/use-forge-data. The import-graph test asserts the Forge's screen does not fetch
 * for exactly this reason; this one follows the same rule by construction.
 */

export interface LedgerScreenProps {
  data: LedgerData;
  profileId: string;
}

export function LedgerScreen({ data, profileId }: LedgerScreenProps) {
  const { loaded, error, localDate, reload } = data;

  const [ventureId, setVentureId] = useState<string | null>(null);
  const [counts, setCounts] = useState<CountDraft>({});
  const [state, setState] = useState<LedgerState>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);

  const send = useCallback(async (entry: OutboxEntry) => {
    if (entry.key.startsWith('money:')) {
      await sendMoneyEntry(entry.payload as MoneyPayload);
      return;
    }
    await sendBusinessDay(entry.payload as BusinessDayPayload);
  }, []);
  const outbox = useOutbox(profileId, send);

  // Adopt the loaded day during render rather than in an effect — see ForgeScreen for why.
  const [adopted, setAdopted] = useState<LedgerLoaded | null>(null);
  if (loaded !== adopted) {
    setAdopted(loaded);
    const first = loaded?.ventures[0]?.id ?? null;
    const active = ventureId && loaded?.ventures.some((v) => v.id === ventureId) ? ventureId : first;
    setVentureId(active);
    setCounts(active ? (loaded?.today[active] ?? {}) : {});
  }

  const onVenture = useCallback(
    (next: string) => {
      setVentureId(next);
      setCounts(loaded?.today[next] ?? {});
      setState('idle');
      setRefusal(null);
    },
    [loaded],
  );

  const onCount = useCallback((actionId: string, count: number) => {
    setCounts((current) => setCount(current, actionId, count));
    setState('idle');
    setRefusal(null);
  }, []);

  const filing = useRef(false);

  const onFile = useCallback(async () => {
    if (filing.current || !ventureId) return;
    const payload = toPayload(ventureId, localDate, counts);
    if (!payload) return;

    filing.current = true;
    setState('working');
    setRefusal(null);
    try {
      const outcome = await outbox.queue(businessDayKey(ventureId, localDate), payload);
      if (outcome.sent) {
        setState('sent');
        reload();
      } else if (outcome.refused) {
        setState('refused');
        setRefusal(ledgerRefusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      } else if (outcome.lost) {
        setState('lost');
      } else {
        setState('held');
      }
    } finally {
      filing.current = false;
    }
  }, [counts, localDate, outbox, reload, ventureId]);

  const onMoney = useCallback(
    async (input: {
      amount: string;
      currency: CurrencyCode;
      category: MoneyCategory;
      isRecurring: boolean;
      note: string;
    }) => {
      if (!ventureId) return;
      // crypto.randomUUID, not Math.random: this id is the idempotency key for a payment, and a
      // collision would merge two men's separate sales into one row.
      const id = crypto.randomUUID();
      const payload = toMoneyPayload({
        id,
        ventureId,
        occurredOn: localDate,
        direction: CATEGORY_DIRECTION[input.category],
        amount: parseMoney(input.amount, input.currency),
        category: input.category,
        isRecurring: input.isRecurring,
        note: input.note.trim() === '' ? null : input.note.trim(),
      });

      setRefusal(null);
      const outcome = await outbox.queue(moneyKey(id), payload);
      if (outcome.sent) reload();
      else if (outcome.refused) {
        setRefusal(ledgerRefusalMessage(outcome.failure?.message ?? 'Unknown reason'));
      }
    },
    [localDate, outbox, reload, ventureId],
  );

  if (error) {
    return (
      <Panel>
        <p role="alert" className="text-sm text-status-fail">
          {error}
        </p>
      </Panel>
    );
  }

  if (!loaded) {
    return (
      <Panel>
        <p aria-busy="true" className="text-sm text-text-muted">
          Loading the Ledger…
        </p>
      </Panel>
    );
  }

  if (naming) {
    return (
      <NewVenture
        profileId={profileId}
        localDate={localDate}
        onDone={() => {
          setNaming(false);
          reload();
        }}
        onCancel={() => setNaming(false)}
      />
    );
  }

  return (
    <LedgerForm
      ventures={loaded.ventures}
      actions={loaded.actions}
      ventureId={ventureId}
      counts={counts}
      money={loaded.money}
      unreadableMoney={loaded.unreadableMoney}
      localDate={localDate}
      state={state}
      statusMessage={
        state === 'sent' && outbox.status.state === 'empty'
          ? 'Recorded. It is on the server.'
          : state === 'idle'
            ? 'Not recorded yet.'
            : describeQueue(outbox)
      }
      refusal={refusal}
      alreadyFiled={Boolean(ventureId && loaded.today[ventureId])}
      onVenture={onVenture}
      onCount={onCount}
      onFile={() => void onFile()}
      onMoney={(input) => void onMoney(input)}
      onNewVenture={() => setNaming(true)}
    />
  );
}

/**
 * Naming the first venture.
 *
 * Written straight rather than through the outbox: it is a one-off setup step a man does while
 * looking at the screen, not a daily entry filed from a car park, and queueing it would mean the
 * next screen has nothing to attach a day to.
 */
function NewVenture({
  profileId,
  localDate,
  onDone,
  onCancel,
}: {
  profileId: string;
  localDate: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setProblem(null);
    const { error } = await getSupabase().from('ventures').insert({
      owner_id: profileId,
      name: name.trim(),
      kind: kind.trim() === '' ? null : kind.trim(),
      started_on: localDate,
    });
    if (error) {
      setProblem(
        /ventures_name_unique_per_owner/.test(error.message)
          ? 'You already have a venture with that name.'
          : error.message,
      );
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
  }

  return (
    <Panel>
      <h2 className="text-sm font-semibold text-text-primary">Name the venture</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
        It does not have to be a company. A service you sell, a product you are building, or the
        thing you would name if somebody asked what you are working on.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:max-w-sm">
        <div>
          <label htmlFor="venture-name" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
            Name
          </label>
          <input
            id="venture-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Consultancy"
            className="mt-1.5 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
          />
        </div>
        <div>
          <label htmlFor="venture-kind" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
            What kind
          </label>
          <input
            id="venture-kind"
            type="text"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            placeholder="B2B services"
            className="mt-1.5 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
          />
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button onClick={() => void save()} disabled={busy || name.trim() === ''}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="mt-3 text-sm text-status-fail">
          {problem}
        </p>
      ) : null}
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section
      data-testid="ledger"
      className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5"
    >
      {children}
    </section>
  );
}
