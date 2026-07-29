import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  abs,
  add,
  allocate,
  compare,
  CurrencyMismatchError,
  divideRoundHalfUp,
  equals,
  formatMoney,
  formatMoneyPlain,
  fromMinor,
  fromRow,
  isCurrencyCode,
  isNegative,
  isZero,
  MoneyError,
  multiplyByRatio,
  negate,
  parseMoney,
  subtract,
  sum,
  toMajorString,
  zero,
  type Money,
} from '@/lib/money';

describe('the premise', () => {
  it('is that floats cannot hold money', () => {
    // The reason this module exists, as an executable assertion.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(1.005 * 100).toBeCloseTo(100.49999999999999, 10);

    // The same two figures, done properly:
    const total = add(parseMoney('0.10', 'USD'), parseMoney('0.20', 'USD'));
    expect(total.amountMinor).toBe(30n);
    expect(toMajorString(total)).toBe('0.30');
  });
});

describe('parseMoney', () => {
  it('parses ordinary input', () => {
    expect(parseMoney('12.34', 'USD').amountMinor).toBe(1234n);
    expect(parseMoney('0.01', 'USD').amountMinor).toBe(1n);
    expect(parseMoney('0', 'USD').amountMinor).toBe(0n);
    expect(parseMoney('1000', 'USD').amountMinor).toBe(100000n);
    expect(parseMoney('.5', 'USD').amountMinor).toBe(50n);
    expect(parseMoney('7.', 'USD').amountMinor).toBe(700n);
  });

  it('parses what people actually type', () => {
    expect(parseMoney(' 1,250.00 ', 'USD').amountMinor).toBe(125000n);
    expect(parseMoney('+40', 'USD').amountMinor).toBe(4000n);
    expect(parseMoney('-40', 'USD').amountMinor).toBe(-4000n);
  });

  it('honours each currency’s own exponent', () => {
    expect(parseMoney('1000', 'JPY').amountMinor).toBe(1000n); // no minor unit
    expect(parseMoney('1.234', 'KWD').amountMinor).toBe(1234n); // three places
    expect(parseMoney('1.50', 'JPY').amountMinor).toBe(2n); // rounds, does not truncate
  });

  it('rounds excess precision half-up away from zero', () => {
    // The x.005 boundary, in both directions.
    expect(parseMoney('1.005', 'USD').amountMinor).toBe(101n);
    expect(parseMoney('-1.005', 'USD').amountMinor).toBe(-101n);
    expect(parseMoney('1.004', 'USD').amountMinor).toBe(100n);
    expect(parseMoney('-1.004', 'USD').amountMinor).toBe(-100n);
    expect(parseMoney('2.675', 'USD').amountMinor).toBe(268n); // the classic float failure
    expect(parseMoney('0.999', 'USD').amountMinor).toBe(100n);
  });

  it('rejects what is not an amount', () => {
    for (const bad of ['', ' ', '.', '-', 'abc', '1.2.3', '1e5', '$5', '--1']) {
      expect(() => parseMoney(bad, 'USD'), bad).toThrow(MoneyError);
    }
  });

  it('rejects an unsupported currency rather than guessing an exponent', () => {
    expect(() => parseMoney('1.00', 'XYZ' as 'USD')).toThrow(MoneyError);
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('XYZ')).toBe(false);
  });

  it('holds amounts far beyond what a double can represent exactly', () => {
    // 2^53 minor units is ~90 trillion yen; a `number` silently loses the last digits.
    const huge = '9007199254740993'; // 2^53 + 1
    expect(parseMoney(huge, 'JPY').amountMinor).toBe(9007199254740993n);
    expect(toMajorString(parseMoney(huge, 'JPY'))).toBe(huge);

    // Compared as strings: writing the numeric literal here would be rounded by the
    // parser before the assertion ran, and the test would pass while proving nothing.
    expect(String(Number(huge))).toBe('9007199254740992');
    expect(String(Number(huge))).not.toBe(huge);
  });
});

describe('toMajorString', () => {
  it('renders exactly, with padding', () => {
    expect(toMajorString(fromMinor(1234n, 'USD'))).toBe('12.34');
    expect(toMajorString(fromMinor(5n, 'USD'))).toBe('0.05');
    expect(toMajorString(fromMinor(0n, 'USD'))).toBe('0.00');
    expect(toMajorString(fromMinor(-5n, 'USD'))).toBe('-0.05');
    expect(toMajorString(fromMinor(-1234n, 'USD'))).toBe('-12.34');
    expect(toMajorString(fromMinor(1234n, 'JPY'))).toBe('1234');
    expect(toMajorString(fromMinor(1234n, 'KWD'))).toBe('1.234');
  });
});

describe('arithmetic', () => {
  const usd = (n: bigint): Money => fromMinor(n, 'USD');

  it('adds, subtracts, negates and compares', () => {
    expect(add(usd(1234n), usd(766n)).amountMinor).toBe(2000n);
    expect(subtract(usd(1000n), usd(2500n)).amountMinor).toBe(-1500n);
    expect(negate(usd(1500n)).amountMinor).toBe(-1500n);
    expect(abs(usd(-1500n)).amountMinor).toBe(1500n);
    expect(compare(usd(1n), usd(2n))).toBe(-1);
    expect(compare(usd(2n), usd(1n))).toBe(1);
    expect(compare(usd(2n), usd(2n))).toBe(0);
    expect(equals(usd(2n), usd(2n))).toBe(true);
    expect(equals(usd(2n), fromMinor(2n, 'EUR'))).toBe(false);
    expect(isZero(zero('USD'))).toBe(true);
    expect(isNegative(usd(-1n))).toBe(true);
  });

  it('refuses to mix currencies instead of quietly adding the numbers', () => {
    // A silent USD+EUR addition is a wrong revenue figure that looks completely normal.
    expect(() => add(usd(100n), fromMinor(100n, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(usd(100n), fromMinor(100n, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => compare(usd(100n), fromMinor(100n, 'EUR'))).toThrow(CurrencyMismatchError);
    expect(() => sum([usd(100n), fromMinor(100n, 'EUR')], 'USD')).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero of a stated currency', () => {
    expect(sum([], 'USD')).toEqual({ amountMinor: 0n, currency: 'USD' });
  });

  it('sums a large ledger without drift', () => {
    // 10,000 entries of 0.07 is exactly 700.00. The float version is not.
    const entries = Array.from({ length: 10_000 }, () => parseMoney('0.07', 'USD'));
    expect(toMajorString(sum(entries, 'USD'))).toBe('700.00');

    const floatTotal = Array.from({ length: 10_000 }, () => 0.07).reduce((a, b) => a + b, 0);
    expect(floatTotal).not.toBe(700);
  });
});

describe('divideRoundHalfUp / multiplyByRatio', () => {
  it('rounds halves away from zero, symmetrically', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(3n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divideRoundHalfUp(2n, 3n)).toBe(1n);
    expect(divideRoundHalfUp(0n, 3n)).toBe(0n);
  });

  it('makes a charge and its reversal cancel exactly', () => {
    // This is why halves go away from zero rather than toward +∞: otherwise a fee and
    // its refund differ by a penny and the discrepancy surfaces as an unexplained
    // rounding error in a monthly total.
    const charge = multiplyByRatio(fromMinor(1005n, 'USD'), 1n, 2n);
    const refund = multiplyByRatio(fromMinor(-1005n, 'USD'), 1n, 2n);
    expect(add(charge, refund).amountMinor).toBe(0n);
  });

  it('scales by a rational without ever seeing a float', () => {
    expect(multiplyByRatio(fromMinor(10000n, 'USD'), 3n, 100n).amountMinor).toBe(300n);
    expect(multiplyByRatio(fromMinor(333n, 'USD'), 1n, 3n).amountMinor).toBe(111n);
    expect(() => multiplyByRatio(fromMinor(1n, 'USD'), 1n, 0n)).toThrow(MoneyError);
  });
});

describe('allocate', () => {
  it('splits without losing or inventing a minor unit', () => {
    const parts = allocate(parseMoney('10.00', 'USD'), [1n, 1n, 1n]);
    expect(parts.map(toMajorString)).toEqual(['3.34', '3.33', '3.33']);
    expect(sum(parts, 'USD').amountMinor).toBe(1000n);
  });

  it('splits by weight', () => {
    const parts = allocate(parseMoney('100.00', 'USD'), [70n, 30n]);
    expect(parts.map(toMajorString)).toEqual(['70.00', '30.00']);
  });

  it('handles negatives', () => {
    const parts = allocate(parseMoney('-10.00', 'USD'), [1n, 1n, 1n]);
    expect(sum(parts, 'USD').amountMinor).toBe(-1000n);
  });

  it('rejects degenerate weights', () => {
    expect(() => allocate(parseMoney('1.00', 'USD'), [])).toThrow(MoneyError);
    expect(() => allocate(parseMoney('1.00', 'USD'), [0n, 0n])).toThrow(MoneyError);
    expect(() => allocate(parseMoney('1.00', 'USD'), [-1n, 2n])).toThrow(MoneyError);
  });
});

describe('fromRow', () => {
  it('reads bigint columns as strings, which is how the driver returns them', () => {
    expect(fromRow('9007199254740993', 'JPY').amountMinor).toBe(9007199254740993n);
    expect(fromRow(1234n, 'USD').amountMinor).toBe(1234n);
    expect(fromRow('-500', 'USD').amountMinor).toBe(-500n);
  });

  it('rejects a row that is not an integer count of minor units', () => {
    expect(() => fromRow('12.34', 'USD')).toThrow(MoneyError);
    expect(() => fromRow('1234', 'XYZ')).toThrow(MoneyError);
  });
});

describe('formatting (the edge, and only the edge)', () => {
  it('formats without going through a double', () => {
    expect(formatMoney(parseMoney('1234.50', 'USD'))).toBe('$1,234.50');
    expect(formatMoney(parseMoney('-99.99', 'USD'))).toBe('-$99.99');
    expect(formatMoney(parseMoney('1234', 'JPY'), 'en-US')).toBe('¥1,234');
    expect(formatMoneyPlain(parseMoney('1234.50', 'USD'))).toBe('1,234.50');
  });

  it('formats an amount larger than Number.MAX_SAFE_INTEGER exactly', () => {
    const huge = fromMinor(9007199254740993n, 'JPY'); // 2^53 + 1
    expect(formatMoney(huge, 'en-US')).toContain('9,007,199,254,740,993');
    // Proof the naive path would have lost it:
    expect(
      new Intl.NumberFormat('en-US').format(Number(9007199254740993n)),
    ).toContain('9,007,199,254,740,992');
  });
});

describe('property: order of operations cannot change a total', () => {
  const minorUnits = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });

  it('sum-then-convert equals convert-then-sum', () => {
    // The spec's stated property. Converting each amount to its major-unit string and
    // parsing it back must be a no-op, so summing before or after conversion agrees.
    fc.assert(
      fc.property(fc.array(minorUnits, { maxLength: 200 }), (amounts) => {
        const monies = amounts.map((m) => fromMinor(m, 'USD'));

        const sumThenConvert = toMajorString(sum(monies, 'USD'));
        const convertThenSum = toMajorString(
          sum(
            monies.map((m) => parseMoney(toMajorString(m), 'USD')),
            'USD',
          ),
        );

        expect(convertThenSum).toBe(sumThenConvert);
      }),
      { numRuns: 500 },
    );
  });

  it('parse ∘ render is the identity for every currency exponent', () => {
    fc.assert(
      fc.property(
        minorUnits,
        fc.constantFrom('USD' as const, 'JPY' as const, 'KWD' as const),
        (amount, currency) => {
          const money = fromMinor(amount, currency);
          expect(parseMoney(toMajorString(money), currency).amountMinor).toBe(amount);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('addition is associative and commutative, however the entries are ordered', () => {
    // A ledger total must not depend on the order rows came back from Postgres.
    fc.assert(
      fc.property(fc.array(minorUnits, { minLength: 1, maxLength: 100 }), (amounts) => {
        const monies = amounts.map((m) => fromMinor(m, 'USD'));
        const forwards = sum(monies, 'USD');
        const backwards = sum([...monies].reverse(), 'USD');
        const folded = monies.reduce((acc, m) => add(acc, m), zero('USD'));
        expect(equals(forwards, backwards)).toBe(true);
        expect(equals(forwards, folded)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('allocate always reconciles to the original amount', () => {
    fc.assert(
      fc.property(
        minorUnits,
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 12 }),
        (amount, weights) => {
          fc.pre(weights.some((w) => w > 0n));
          const money = fromMinor(amount, 'USD');
          const parts = allocate(money, weights);
          expect(sum(parts, 'USD').amountMinor).toBe(amount);
          expect(parts).toHaveLength(weights.length);
        },
      ),
      { numRuns: 500 },
    );
  });
});
