import { add, fromMinor, isCurrencyCode, zero, type CurrencyCode, type Money } from '@/lib/money';

/**
 * The Ledger's day, as a value.
 *
 * Pure and separate from the screen, like the SITREP's draft model, so the rules can be tested
 * without a browser. The rules that matter here are about counts and money, and both have a
 * specific way of going wrong: a count that accepts a tick stops measuring volume, and money that
 * touches a float loses pennies nobody notices for a year.
 */

export interface BusinessAction {
  id: string;
  slug: string;
  label: string;
  /** What one unit is, said plainly. "4" means nothing without it. */
  unit: string;
  hint: string | null;
  sortOrder: number;
}

export interface Venture {
  id: string;
  name: string;
  kind: string | null;
  status: 'active' | 'paused' | 'closed';
  startedOn: string;
}

/** Counts keyed by action id. Absent means "not recorded", which is not the same as zero. */
export type CountDraft = Record<string, number>;

/**
 * The largest count the entry accepts.
 *
 * Mirrors the SQL constraint `daily_business_entries_count_sane`. It is a typo guard, not a
 * judgement: nobody makes 1,001 offers in a day, and a fat-fingered 400 in the follow-ups column
 * would quietly wreck every ratio Phase 6 computes.
 */
export const MAX_COUNT = 1000;

export function emptyCounts(): CountDraft {
  return {};
}

/**
 * Set one action's count.
 *
 * Clamped rather than rejected. A man tapping + on a phone should not be able to produce an
 * error state from a button whose only job is to increase a number; the cap is enforced for real
 * by the database, and this stops the UI ever sending something it knows is wrong.
 */
export function setCount(draft: CountDraft, actionId: string, count: number): CountDraft {
  const clamped = Math.max(0, Math.min(MAX_COUNT, Math.trunc(count)));
  return { ...draft, [actionId]: clamped };
}

export function bump(draft: CountDraft, actionId: string, by: number): CountDraft {
  return setCount(draft, actionId, (draft[actionId] ?? 0) + by);
}

/** Whether anything has actually been recorded. A day of zeroes is a claim; an empty day is not. */
export function hasAnyCount(draft: CountDraft): boolean {
  return Object.keys(draft).length > 0;
}

/** The day's total effort, for a one-line summary. */
export function totalCount(draft: CountDraft): number {
  return Object.values(draft).reduce((running, value) => running + value, 0);
}

export interface BusinessDayPayload {
  ventureId: string;
  localDate: string;
  counts: { actionId: string; count: number }[];
}

/**
 * The write, shaped for `public.file_business_day`.
 *
 * Null when nothing has been entered, so an empty form cannot be filed. Unlike the SITREP there
 * is no completeness rule — a man who made no offers today and does not say so has recorded
 * nothing, which is honest; a man who types 0 has said "none", which is a different fact and the
 * one worth having.
 */
export function toPayload(
  ventureId: string,
  localDate: string,
  draft: CountDraft,
): BusinessDayPayload | null {
  const counts = Object.entries(draft).map(([actionId, count]) => ({ actionId, count }));
  if (counts.length === 0) return null;
  return { ventureId, localDate, counts };
}

/** The outbox coalescing key. One slot per venture per day, matching the unique index. */
export function businessDayKey(ventureId: string, localDate: string): string {
  return `business:${ventureId}:${localDate}`;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

export type MoneyDirection = 'in' | 'out';
export type MoneyCategory =
  | 'sale'
  | 'recurring'
  | 'refund'
  | 'advertising'
  | 'tooling'
  | 'contractor'
  | 'other';

export const MONEY_CATEGORIES: readonly MoneyCategory[] = [
  'sale',
  'recurring',
  'refund',
  'advertising',
  'tooling',
  'contractor',
  'other',
];

export const CATEGORY_LABELS: Record<MoneyCategory, string> = {
  sale: 'Sale',
  recurring: 'Recurring',
  refund: 'Refund',
  advertising: 'Advertising',
  tooling: 'Tooling',
  contractor: 'Contractor',
  other: 'Other',
};

/** Which way each category normally moves, so the form can default the direction sensibly. */
export const CATEGORY_DIRECTION: Record<MoneyCategory, MoneyDirection> = {
  sale: 'in',
  recurring: 'in',
  // A refund is money leaving, even though it belongs to a sale. Filed as 'out' so that revenue
  // totals do not have to know about it as a special case.
  refund: 'out',
  advertising: 'out',
  tooling: 'out',
  contractor: 'out',
  other: 'in',
};

export interface MoneyEntry {
  id: string;
  ventureId: string;
  occurredOn: string;
  direction: MoneyDirection;
  amount: Money;
  category: MoneyCategory;
  isRecurring: boolean;
  note: string | null;
}

export interface MoneyPayload {
  id: string;
  ventureId: string;
  occurredOn: string;
  direction: MoneyDirection;
  /**
   * Serialised as a **string**, not a number.
   *
   * `amountMinor` is a bigint, and `JSON.stringify` throws on one. Sending it as a JS number
   * would silently lose precision past 2^53 — which is £90 trillion in pennies and therefore not
   * a practical risk, but the whole point of §3.2 is that money never passes through a type that
   * *can* round it. Postgres parses the string straight into bigint.
   */
  amountMinor: string;
  currency: CurrencyCode;
  category: MoneyCategory;
  isRecurring: boolean;
  note: string | null;
}

export function toMoneyPayload(entry: MoneyEntry): MoneyPayload {
  return {
    id: entry.id,
    ventureId: entry.ventureId,
    occurredOn: entry.occurredOn,
    direction: entry.direction,
    amountMinor: entry.amount.amountMinor.toString(),
    currency: entry.amount.currency,
    category: entry.category,
    isRecurring: entry.isRecurring,
    note: entry.note,
  };
}

/**
 * The outbox coalescing key for one money entry.
 *
 * Keyed on the entry's own id, which the client generates before the first attempt. That is what
 * makes a retry after an ambiguous failure land on the same row instead of booking the payment
 * twice — the reason `money_entries.id` has no default in the schema.
 */
export function moneyKey(entryId: string): string {
  return `money:${entryId}`;
}

export interface MoneyTotals {
  in: Money;
  out: Money;
  net: Money;
  currency: CurrencyCode;
}

/**
 * Totals for one currency.
 *
 * One currency at a time, deliberately. Adding GBP to USD needs a rate, a rate needs a date, and
 * a "total" built from a rate somebody guessed is worse than no total — see the
 * CurrencyMismatchError that @/lib/money throws rather than coercing. Entries in other currencies
 * are excluded and counted, so the screen can say so rather than quietly under-reporting.
 */
export function totalsFor(
  entries: readonly MoneyEntry[],
  currency: CurrencyCode,
): MoneyTotals & { excluded: number } {
  let incoming = zero(currency);
  let outgoing = zero(currency);
  let excluded = 0;

  for (const entry of entries) {
    if (entry.amount.currency !== currency) {
      excluded += 1;
      continue;
    }
    if (entry.direction === 'in') incoming = add(incoming, entry.amount);
    else outgoing = add(outgoing, entry.amount);
  }

  return {
    in: incoming,
    out: outgoing,
    // Net can legitimately be negative — a month of building before the first sale. Represented
    // as a negative Money rather than a separate flag, because "minus £400" is the fact.
    net: fromMinor(incoming.amountMinor - outgoing.amountMinor, currency),
    currency,
    excluded,
  };
}

/** Every currency present, so the screen can offer a switch rather than picking one silently. */
export function currenciesIn(entries: readonly MoneyEntry[]): CurrencyCode[] {
  return [...new Set(entries.map((entry) => entry.amount.currency))].sort();
}

/**
 * Read a currency from a row, falling back rather than throwing.
 *
 * A row whose currency this build does not recognise is a real possibility — the database domain
 * accepts any ISO-4217 shape, and CURRENCY_EXPONENTS is a curated list. Returning null lets the
 * caller drop the row and say so; throwing would take the whole screen down over one entry.
 */
export function currencyOf(value: string): CurrencyCode | null {
  return isCurrencyCode(value) ? value : null;
}
