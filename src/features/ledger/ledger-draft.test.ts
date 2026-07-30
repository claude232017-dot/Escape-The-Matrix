import { describe, expect, it } from 'vitest';
import { fromMinor, parseMoney, toMajorString, type CurrencyCode } from '@/lib/money';
import {
  CATEGORY_DIRECTION,
  CATEGORY_LABELS,
  MAX_COUNT,
  MONEY_CATEGORIES,
  bump,
  businessDayKey,
  currenciesIn,
  currencyOf,
  emptyCounts,
  hasAnyCount,
  moneyKey,
  setCount,
  toMoneyPayload,
  toPayload,
  totalCount,
  totalsFor,
  type MoneyEntry,
} from '@/features/ledger/ledger-draft';

/**
 * The Ledger's day model.
 *
 * Two things here carry more than the rest. The counts must never become ticks — ADR-003's whole
 * argument is that "sent 4 offers" says something "did outreach ✓" does not. And money must never
 * pass through a type that can round it, which means the payload leaves as a string and the
 * totals are computed in bigint minor units.
 */

describe('counts', () => {
  it('records a number, not a tick', () => {
    // The distinction ADR-003 rests on. A boolean here would make the whole Ledger measure
    // obedience instead of volume.
    const draft = setCount(emptyCounts(), 'offers', 4);
    expect(draft['offers']).toBe(4);
    expect(typeof draft['offers']).toBe('number');
  });

  it('keeps zero as a real answer', () => {
    // "None today" is a fact worth having. Absent is a different fact — he did not record it.
    const draft = setCount(emptyCounts(), 'offers', 0);
    expect(draft['offers']).toBe(0);
    expect(hasAnyCount(draft)).toBe(true);
    expect(hasAnyCount(emptyCounts())).toBe(false);
  });

  it('clamps rather than erroring', () => {
    // A + button whose only job is to increase a number must not be able to produce an error
    // state. The database enforces the cap for real; this stops the UI ever sending past it.
    expect(setCount(emptyCounts(), 'a', -5)['a']).toBe(0);
    expect(setCount(emptyCounts(), 'a', MAX_COUNT + 1)['a']).toBe(MAX_COUNT);
    expect(setCount(emptyCounts(), 'a', 4.7)['a']).toBe(4);
  });

  it('bumps up and down without going negative', () => {
    let draft = bump(emptyCounts(), 'a', 1);
    draft = bump(draft, 'a', 1);
    expect(draft['a']).toBe(2);
    draft = bump(draft, 'a', -5);
    expect(draft['a']).toBe(0);
  });

  it('does not mutate what it is given', () => {
    const before = setCount(emptyCounts(), 'a', 1);
    const snapshot = structuredClone(before);
    setCount(before, 'a', 9);
    expect(before).toEqual(snapshot);
  });

  it('totals the day', () => {
    let draft = setCount(emptyCounts(), 'offers', 4);
    draft = setCount(draft, 'calls', 3);
    expect(totalCount(draft)).toBe(7);
  });
});

describe('toPayload', () => {
  it('refuses an empty day', () => {
    expect(toPayload('v1', '2026-07-30', emptyCounts())).toBeNull();
  });

  it('sends only what was recorded', () => {
    // Absent means "not recorded", not "zero". A man correcting one number must not wipe the rest,
    // which is why file_business_day upserts rather than delete-then-inserting.
    const draft = setCount(emptyCounts(), 'offers', 4);
    expect(toPayload('v1', '2026-07-30', draft)).toEqual({
      ventureId: 'v1',
      localDate: '2026-07-30',
      counts: [{ actionId: 'offers', count: 4 }],
    });
  });

  it('sends an explicit zero', () => {
    const payload = toPayload('v1', '2026-07-30', setCount(emptyCounts(), 'offers', 0));
    expect(payload?.counts).toEqual([{ actionId: 'offers', count: 0 }]);
  });
});

describe('keys', () => {
  it('gives one outbox slot per venture per day', () => {
    expect(businessDayKey('v1', '2026-07-30')).toBe('business:v1:2026-07-30');
    expect(businessDayKey('v1', '2026-07-31')).not.toBe(businessDayKey('v1', '2026-07-30'));
    expect(businessDayKey('v2', '2026-07-30')).not.toBe(businessDayKey('v1', '2026-07-30'));
  });

  it('keys money on the entry id, so a retry lands on the same row', () => {
    // The reason money_entries.id has no default: a server-generated id would make every retry
    // a new row, and an ambiguous failure would book the payment twice.
    expect(moneyKey('abc')).toBe('money:abc');
    expect(moneyKey('abc')).not.toBe(moneyKey('def'));
  });
});

describe('money categories', () => {
  it('labels every category', () => {
    for (const category of MONEY_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
      expect(CATEGORY_DIRECTION[category]).toMatch(/^(in|out)$/);
    }
  });

  it('treats a refund as money leaving', () => {
    // Even though it belongs to a sale. Filed as 'out' so revenue totals need no special case.
    expect(CATEGORY_DIRECTION.refund).toBe('out');
    expect(CATEGORY_DIRECTION.sale).toBe('in');
    expect(CATEGORY_DIRECTION.advertising).toBe('out');
  });
});

describe('toMoneyPayload', () => {
  function entry(overrides: Partial<MoneyEntry> = {}): MoneyEntry {
    return {
      id: 'e1',
      ventureId: 'v1',
      occurredOn: '2026-07-30',
      direction: 'in',
      amount: parseMoney('1250.00', 'GBP'),
      category: 'sale',
      isRecurring: false,
      note: null,
      ...overrides,
    };
  }

  it('sends the amount as a string', () => {
    // §3.2. JSON.stringify throws on a bigint, and a JS number is a type that *can* round — the
    // rule is that money never passes through one, not that the current amounts are small.
    const payload = toMoneyPayload(entry());
    expect(payload.amountMinor).toBe('125000');
    expect(typeof payload.amountMinor).toBe('string');
    expect(payload.currency).toBe('GBP');
  });

  it('survives an amount past the safe integer range', () => {
    // £90 trillion in pennies. Not a practical figure — the point is that the wire format cannot
    // lose it, so the rule holds without depending on the numbers staying small.
    const huge = fromMinor(9_007_199_254_740_993n, 'GBP');
    expect(toMoneyPayload(entry({ amount: huge })).amountMinor).toBe('9007199254740993');
  });

  it('serialises to JSON without throwing', () => {
    // The failure this guards is not hypothetical: passing the bigint straight through makes
    // JSON.stringify throw, and the outbox would reject the entry as permanent.
    expect(() => JSON.stringify(toMoneyPayload(entry()))).not.toThrow();
  });
});

describe('totalsFor', () => {
  function entry(direction: 'in' | 'out', major: string, currency: CurrencyCode = 'GBP'): MoneyEntry {
    return {
      id: `${direction}-${major}-${currency}`,
      ventureId: 'v1',
      occurredOn: '2026-07-30',
      direction,
      amount: parseMoney(major, currency),
      category: direction === 'in' ? 'sale' : 'tooling',
      isRecurring: false,
      note: null,
    };
  }

  it('adds in bigint minor units', () => {
    // The classic float failure: 0.1 + 0.2 !== 0.3. Asserted on a string so the comparison cannot
    // itself be rounded by the parser.
    const totals = totalsFor([entry('in', '0.10'), entry('in', '0.20')], 'GBP');
    expect(toMajorString(totals.in)).toBe('0.30');
    expect(totals.in.amountMinor).toBe(30n);
  });

  it('nets income against spend', () => {
    const totals = totalsFor([entry('in', '1250.00'), entry('out', '400.00')], 'GBP');
    expect(toMajorString(totals.in)).toBe('1250.00');
    expect(toMajorString(totals.out)).toBe('400.00');
    expect(toMajorString(totals.net)).toBe('850.00');
  });

  it('reports a negative net as a fact', () => {
    // A month of building before the first sale. "Minus £400" is the truth and is represented as
    // negative Money rather than hidden behind a flag or clamped at zero.
    const totals = totalsFor([entry('out', '400.00')], 'GBP');
    expect(toMajorString(totals.net)).toBe('-400.00');
  });

  it('excludes other currencies and says how many', () => {
    // Adding GBP to USD needs a rate, a rate needs a date, and a total built from a guessed rate
    // is worse than no total. Excluded and counted, so the screen can say so.
    const totals = totalsFor([entry('in', '100.00'), entry('in', '100.00', 'USD')], 'GBP');
    expect(toMajorString(totals.in)).toBe('100.00');
    expect(totals.excluded).toBe(1);
  });

  it('is zero, not undefined, for an empty ledger', () => {
    const totals = totalsFor([], 'GBP');
    expect(toMajorString(totals.net)).toBe('0.00');
    expect(totals.excluded).toBe(0);
  });

  it('handles a currency with no minor unit', () => {
    // JPY has exponent 0. A total that assumed two decimal places would be wrong by a factor of
    // a hundred, which is the kind of bug that survives a demo.
    const jpy: MoneyEntry = { ...entry('in', '100'), amount: parseMoney('1500', 'JPY') };
    const totals = totalsFor([jpy], 'JPY');
    expect(toMajorString(totals.in)).toBe('1500');
    expect(totals.in.amountMinor).toBe(1500n);
  });
});

describe('currenciesIn', () => {
  it('lists each currency once, sorted', () => {
    const entries: MoneyEntry[] = (['USD', 'GBP', 'USD'] as const).map((currency, index) => ({
      id: `e${index}`,
      ventureId: 'v1',
      occurredOn: '2026-07-30',
      direction: 'in',
      amount: parseMoney('1.00', currency),
      category: 'sale',
      isRecurring: false,
      note: null,
    }));
    expect(currenciesIn(entries)).toEqual(['GBP', 'USD']);
  });
});

describe('currencyOf', () => {
  it('accepts a supported code', () => {
    expect(currencyOf('GBP')).toBe('GBP');
  });

  it('returns null rather than throwing on one this build does not know', () => {
    // The database domain accepts any ISO-4217 shape; CURRENCY_EXPONENTS is a curated list. One
    // unrecognised row must not take the whole screen down.
    expect(currencyOf('XYZ')).toBeNull();
    expect(currencyOf('gbp')).toBeNull();
    expect(currencyOf('')).toBeNull();
  });
});
