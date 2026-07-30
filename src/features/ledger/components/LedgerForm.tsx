import { useState } from 'react';
import { exponentOf, formatMoney, parseMoney, type CurrencyCode } from '@/lib/money';
import {
  CATEGORY_DIRECTION,
  CATEGORY_LABELS,
  MONEY_CATEGORIES,
  MAX_COUNT,
  currenciesIn,
  totalsFor,
  type BusinessAction,
  type CountDraft,
  type MoneyCategory,
  type MoneyEntry,
  type Venture,
} from '@/features/ledger/ledger-draft';
import { Button } from '@/ui/Button';

/**
 * The Ledger, with no data access in it.
 *
 * Every input is a prop, like the SITREP's form, so it can be driven in a browser without
 * credentials.
 *
 * The counts are **steppers, not text fields**. ADR-003's fifth criterion is that the whole thing
 * be fillable one-handed in under a minute, and the realistic numbers are single digits: a man
 * making four offers taps + four times, which is faster than focusing a field and typing. The
 * field is still there for the day somebody sends forty follow-ups.
 *
 * Money is a separate act with a separate button. It is not part of the daily rhythm — most days
 * have no money in them at all — and putting an amount field in the daily entry would make every
 * empty day feel like a failure to report something.
 */

export type LedgerState = 'idle' | 'working' | 'sent' | 'held' | 'refused' | 'lost';

export interface LedgerFormProps {
  ventures: readonly Venture[];
  actions: readonly BusinessAction[];
  ventureId: string | null;
  counts: CountDraft;
  money: readonly MoneyEntry[];
  unreadableMoney: number;
  localDate: string;
  state: LedgerState;
  statusMessage: string;
  refusal: string | null;
  /** True once today's counts are on the server for this venture. */
  alreadyFiled: boolean;
  onVenture: (ventureId: string) => void;
  onCount: (actionId: string, count: number) => void;
  onFile: () => void;
  onMoney: (input: {
    amount: string;
    currency: CurrencyCode;
    category: MoneyCategory;
    isRecurring: boolean;
    note: string;
  }) => void;
  onNewVenture: () => void;
}

export function LedgerForm({
  ventures,
  actions,
  ventureId,
  counts,
  money,
  unreadableMoney,
  localDate,
  state,
  statusMessage,
  refusal,
  alreadyFiled,
  onVenture,
  onCount,
  onFile,
  onMoney,
  onNewVenture,
}: LedgerFormProps) {
  if (ventures.length === 0) {
    return (
      <section data-testid="ledger" className="rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised p-5">
        <h2 className="text-sm font-semibold text-text-primary">No venture yet</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-text-secondary">
          The Ledger records what you did to build something and what came in. Name the something
          first — it can be a business, a service, a product, or an idea you have not sold yet.
        </p>
        <Button className="mt-4" onClick={onNewVenture} data-testid="new-venture">
          Add a venture
        </Button>
      </section>
    );
  }

  const venture = ventures.find((candidate) => candidate.id === ventureId) ?? ventures[0];
  const ventureMoney = money.filter((entry) => entry.ventureId === venture?.id);

  return (
    <section aria-labelledby="ledger-heading" data-testid="ledger" data-venture={venture?.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="ledger-heading" className="text-sm font-semibold text-text-primary">
          Today&apos;s Ledger
        </h2>
        <p className="text-xs text-text-muted">
          <span data-numeral>{localDate}</span>
          {alreadyFiled ? ' · already recorded, changing a number replaces it' : ''}
        </p>
      </div>

      {ventures.length > 1 ? (
        <div className="mt-3">
          <label htmlFor="ledger-venture" className="sr-only">
            Which venture
          </label>
          <select
            id="ledger-venture"
            value={venture?.id ?? ''}
            onChange={(event) => onVenture(event.target.value)}
            className="min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary sm:max-w-sm"
          >
            {ventures.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.status === 'active' ? '' : ` (${candidate.status})`}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-border-subtle bg-surface-raised">
        <h3 className="flex items-baseline gap-2 bg-surface-base px-4 py-2 sm:px-5">
          <span className="text-xs font-semibold tracking-[0.16em] text-text-secondary uppercase">
            What you did
          </span>
          <span className="text-xs text-text-muted">Causes you control, not results</span>
        </h3>
        <ul className="divide-y divide-border-subtle">
          {actions.map((action) => (
            <CountRow
              key={action.id}
              action={action}
              value={counts[action.id]}
              onChange={(next) => onCount(action.id, next)}
            />
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onFile} disabled={state === 'working'} data-testid="file-ledger">
          {state === 'working' ? 'Recording…' : alreadyFiled ? 'Update the day' : 'Record the day'}
        </Button>
        <p
          data-testid="ledger-status"
          role="status"
          className={`text-xs leading-relaxed ${
            state === 'sent'
              ? 'text-status-pass'
              : state === 'refused' || state === 'lost'
                ? 'text-status-fail'
                : 'text-text-muted'
          }`}
        >
          {statusMessage}
        </p>
      </div>

      {refusal ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-status-fail">
          {refusal}
        </p>
      ) : null}

      {venture ? (
        <MoneyPanel
          entries={ventureMoney}
          unreadable={unreadableMoney}
          localDate={localDate}
          onMoney={onMoney}
        />
      ) : null}
    </section>
  );
}

/**
 * One leading indicator.
 *
 * Minus, a number, plus. The number is also a field, because a stepper alone is a trap on the day
 * somebody has forty of something — but the taps are the fast path and the field is the escape
 * hatch, not the other way round.
 */
function CountRow({
  action,
  value,
  onChange,
}: {
  action: BusinessAction;
  value: number | undefined;
  onChange: (count: number) => void;
}) {
  const recorded = value !== undefined;

  return (
    <li data-action={action.slug} data-recorded={recorded ? 'yes' : 'no'} className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">{action.label}</h4>
          {action.hint ? (
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{action.hint}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            className="min-w-11 px-0"
            aria-label={`One fewer ${action.label}`}
            onClick={() => onChange((value ?? 0) - 1)}
            disabled={(value ?? 0) <= 0}
          >
            −
          </Button>
          <label className="sr-only" htmlFor={`count-${action.slug}`}>
            {action.label}, in {action.unit}
          </label>
          <input
            id={`count-${action.slug}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_COUNT}
            data-numeral
            // Empty rather than 0 until he says something. Absent means "not recorded", and
            // pre-filling zeroes would file a claim he never made.
            value={value ?? ''}
            placeholder="—"
            onChange={(event) =>
              onChange(event.target.value === '' ? 0 : Number.parseInt(event.target.value, 10) || 0)
            }
            className="min-h-11 w-14 rounded-[var(--radius-sm)] border border-border-strong bg-surface-base text-center text-sm text-text-primary"
          />
          <Button
            variant="secondary"
            className="min-w-11 px-0"
            aria-label={`One more ${action.label}`}
            onClick={() => onChange((value ?? 0) + 1)}
          >
            +
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Money in and out.
 *
 * Separate from the daily counts, and folded away until he opens it, because most days have no
 * money in them. An amount field sitting open on the daily entry makes every ordinary day look
 * like a failure to report something.
 */
function MoneyPanel({
  entries,
  unreadable,
  localDate,
  onMoney,
}: {
  entries: readonly MoneyEntry[];
  unreadable: number;
  localDate: string;
  onMoney: LedgerFormProps['onMoney'];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<MoneyCategory>('sale');
  const [note, setNote] = useState('');
  const [isRecurring, setRecurring] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const present = currenciesIn(entries);
  const [currency, setCurrency] = useState<CurrencyCode>(present[0] ?? 'GBP');
  const totals = totalsFor(entries, currency);

  function submit() {
    // parseMoney *rounds* excess precision half-up rather than rejecting it, which is right for
    // arithmetic and wrong for a field a man typed into: booking 12.345 as 12.35 is a small lie
    // about a payment. Caught here, where the intent is a typo rather than a computation.
    const exponent = exponentOf(currency);
    const decimals = amount.trim().split('.')[1]?.length ?? 0;
    if (decimals > exponent) {
      setProblem(
        exponent === 0
          ? `${currency} has no decimal places.`
          : `${currency} has ${exponent} decimal places. That amount has ${decimals}.`,
      );
      return;
    }

    try {
      // The only sanctioned way in: a string, parsed to bigint minor units. Never a float.
      parseMoney(amount, currency);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'That is not an amount.');
      return;
    }
    setProblem(null);
    onMoney({ amount, currency, category, isRecurring, note });
    setAmount('');
    setNote('');
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-[0.16em] text-text-secondary uppercase">
          Money
        </h3>
        <Button variant="quiet" onClick={() => setOpen((value) => !value)} data-testid="toggle-money">
          {open ? 'Close' : 'Record money'}
        </Button>
      </div>

      <dl data-testid="money-totals" className="mt-2 grid grid-cols-3 gap-3">
        <Total term="In" value={formatMoney(totals.in)} tone="text-status-pass" />
        <Total term="Out" value={formatMoney(totals.out)} tone="text-status-fail" />
        <Total term="Net" value={formatMoney(totals.net)} tone="text-text-primary" />
      </dl>

      {present.length > 1 ? (
        <div className="mt-2">
          <label htmlFor="money-currency-view" className="sr-only">
            Show totals in
          </label>
          <select
            id="money-currency-view"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
            className="min-h-11 rounded-[var(--radius-sm)] border border-border-strong bg-surface-base px-2 text-xs text-text-primary"
          >
            {present.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {totals.excluded > 0 ? (
        <p className="mt-2 text-xs text-text-muted">
          {/* Adding GBP to USD needs a rate, a rate needs a date, and a total built from a rate
              somebody guessed is worse than no total. Said out loud rather than under-reported. */}
          <span data-numeral>{totals.excluded}</span>{' '}
          {totals.excluded === 1 ? 'entry is' : 'entries are'} in another currency and not included.
        </p>
      ) : null}

      {unreadable > 0 ? (
        <p className="mt-1 text-xs text-status-med">
          <span data-numeral>{unreadable}</span>{' '}
          {unreadable === 1 ? 'entry uses' : 'entries use'} a currency this app does not know, so
          {unreadable === 1 ? ' it is' : ' they are'} not shown.
        </p>
      ) : null}

      {open ? (
        <div data-testid="money-form" className="mt-4 rounded-[var(--radius-md)] border border-border-subtle bg-surface-raised p-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-32 flex-1">
              <label htmlFor="money-amount" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
                Amount
              </label>
              <input
                id="money-amount"
                type="text"
                inputMode="decimal"
                data-numeral
                value={amount}
                placeholder="1250.00"
                onChange={(event) => setAmount(event.target.value)}
                className="mt-1.5 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
              />
            </div>
            <div>
              <label htmlFor="money-currency" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
                Currency
              </label>
              <select
                id="money-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
                className="mt-1.5 block min-h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
              >
                {(['GBP', 'USD', 'EUR', 'AED', 'JPY'] as const).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label htmlFor="money-category" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
              What it was
            </label>
            <select
              id="money-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as MoneyCategory)}
              className="mt-1.5 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary sm:max-w-xs"
            >
              {MONEY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]} ({CATEGORY_DIRECTION[value] === 'in' ? 'in' : 'out'})
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label htmlFor="money-note" className="text-xs font-semibold tracking-[0.14em] text-text-muted uppercase">
              Note
            </label>
            <input
              id="money-note"
              type="text"
              value={note}
              placeholder="Who, and for what"
              onChange={(event) => setNote(event.target.value)}
              className="mt-1.5 block min-h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface-base px-3 text-sm text-text-primary"
            />
          </div>

          <label className="mt-3 flex min-h-11 items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(event) => setRecurring(event.target.checked)}
              className="size-4"
            />
            This repeats every month
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={amount.trim() === ''} data-testid="save-money">
              Record it
            </Button>
            <span className="text-xs text-text-muted">
              on <span data-numeral>{localDate}</span>
            </span>
          </div>

          {problem ? (
            <p role="alert" className="mt-2 text-xs text-status-fail">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ul data-testid="money-list" className="mt-4 divide-y divide-border-subtle">
          {entries.slice(0, 12).map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0 text-xs text-text-secondary">
                <span data-numeral className="text-text-muted">
                  {entry.occurredOn}
                </span>{' '}
                {CATEGORY_LABELS[entry.category]}
                {entry.note ? ` · ${entry.note}` : ''}
              </span>
              <span
                data-numeral
                className={`shrink-0 text-sm ${
                  entry.direction === 'in' ? 'text-status-pass' : 'text-status-fail'
                }`}
              >
                {entry.direction === 'in' ? '+' : '−'}
                {formatMoney(entry.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Total({ term, value, tone }: { term: string; value: string; tone: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-surface-base px-3 py-2">
      <dt className="text-xs tracking-[0.14em] text-text-muted uppercase">{term}</dt>
      <dd data-numeral className={`mt-0.5 text-sm font-semibold ${tone}`}>
        {value}
      </dd>
    </div>
  );
}
