/**
 * Money as integer minor units. No floats, at any layer, ever.
 *
 * `0.1 + 0.2 !== 0.3`, and this is a product whose entire lagging indicator is a
 * number a man is asked to trust. An amount is a `bigint` count of the currency's
 * smallest unit plus an ISO-4217 code; it becomes a string exactly once, at the edge,
 * for display. There is no `number` representation of an amount anywhere in between.
 *
 * Mirror note: the storage side of this rule is `amount_minor bigint NOT NULL` plus a
 * `currency char(3)` column with a CHECK against the same registry — see
 * supabase/migrations and docs/DATA-MODEL.md. Adding a currency here means adding it
 * to that CHECK too, or inserts will be rejected at runtime.
 */

/** ISO-4217 alphabetic code. */
export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

/**
 * ISO-4217 minor-unit exponents for the currencies the circle actually transacts in.
 * Not every currency is 2 — JPY has no minor unit and KWD has three, so hardcoding 100
 * anywhere is a bug waiting for the first international client.
 */
export const CURRENCY_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  ZAR: 2,
  AED: 2,
  INR: 2,
  BRL: 2,
  MXN: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
} as const;

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export class CurrencyMismatchError extends MoneyError {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Refusing to combine ${a} with ${b}: amounts in different currencies are not comparable`);
    this.name = 'CurrencyMismatchError';
  }
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function assertCurrencyCode(value: string): asserts value is CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new MoneyError(`Unknown or unsupported ISO-4217 currency: ${JSON.stringify(value)}`);
  }
}

/** Number of decimal places the currency's minor unit implies. */
export function exponentOf(currency: CurrencyCode): number {
  return CURRENCY_EXPONENTS[currency];
}

function scaleOf(currency: CurrencyCode): bigint {
  return 10n ** BigInt(exponentOf(currency));
}

/** Construct from a count of minor units. The canonical constructor. */
export function fromMinor(amountMinor: bigint, currency: CurrencyCode): Money {
  assertCurrencyCode(currency);
  return { amountMinor, currency };
}

export function zero(currency: CurrencyCode): Money {
  return fromMinor(0n, currency);
}

/**
 * Read an amount out of a database row.
 *
 * `bigint` columns arrive from node-postgres as strings precisely because they do not
 * fit a JS `number`; parsing them with `Number()` is the exact failure this function
 * exists to make impossible.
 */
export function fromRow(amountMinor: string | bigint, currency: string): Money {
  assertCurrencyCode(currency);
  const minor = typeof amountMinor === 'bigint' ? amountMinor : parseMinorString(amountMinor);
  return { amountMinor: minor, currency };
}

function parseMinorString(value: string): bigint {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new MoneyError(`Expected an integer count of minor units, got ${JSON.stringify(value)}`);
  }
  return BigInt(trimmed);
}

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?$/;

/**
 * Parse a major-unit decimal string — what a man types into a revenue field.
 *
 * Deliberately takes a `string`, not a `number`: accepting a `number` would mean the
 * caller had already gone through a float and the precision would already be gone.
 * Excess decimal places are rounded half-up away from zero rather than truncated, so
 * `1.005` becomes 1.01 and `-1.005` becomes -1.01.
 */
export function parseMoney(input: string, currency: CurrencyCode): Money {
  assertCurrencyCode(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-' || cleaned === '+') {
    throw new MoneyError(`Not a monetary amount: ${JSON.stringify(input)}`);
  }
  const match = DECIMAL_RE.exec(cleaned);
  if (!match) throw new MoneyError(`Not a monetary amount: ${JSON.stringify(input)}`);

  const [, sign, whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') {
    throw new MoneyError(`Not a monetary amount: ${JSON.stringify(input)}`);
  }

  const exponent = exponentOf(currency);
  const kept = fraction.slice(0, exponent).padEnd(exponent, '0');
  const rest = fraction.slice(exponent);

  let minor = BigInt(whole === '' ? '0' : whole) * scaleOf(currency) + BigInt(kept === '' ? '0' : kept);

  // Half-up on the discarded tail, evaluated as a digit comparison rather than any
  // division, so no precision is lost deciding whether precision would be lost.
  if (rest !== '' && (rest[0] ?? '0') >= '5') minor += 1n;

  return { amountMinor: sign === '-' ? -minor : minor, currency };
}

/**
 * Exact major-unit decimal string. Round-trips through `parseMoney` unchanged.
 *
 * Typed as `StringNumericLiteral` so it can be handed straight to `Intl.NumberFormat`,
 * which accepts a string and formats it exactly. The assertion is the single place in
 * the codebase where that type is claimed rather than proved; everything above it is
 * bigint arithmetic, so the digits are exact by construction.
 */
export function toMajorString(money: Money): Intl.StringNumericLiteral {
  const exponent = exponentOf(money.currency);
  const negative = money.amountMinor < 0n;
  const magnitude = negative ? -money.amountMinor : money.amountMinor;
  const sign = negative ? '-' : '';
  if (exponent === 0) return `${sign}${magnitude.toString()}` as Intl.StringNumericLiteral;
  const scale = scaleOf(money.currency);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(exponent, '0');
  return `${sign}${whole.toString()}.${fraction}` as Intl.StringNumericLiteral;
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function negate(money: Money): Money {
  return { amountMinor: -money.amountMinor, currency: money.currency };
}

export function abs(money: Money): Money {
  return money.amountMinor < 0n ? negate(money) : money;
}

/**
 * Total a list. `currency` is required for the empty case, because "zero of nothing"
 * is not a figure anyone can put on a dashboard.
 */
export function sum(amounts: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n;
  for (const amount of amounts) {
    if (amount.currency !== currency) throw new CurrencyMismatchError(currency, amount.currency);
    total += amount.amountMinor;
  }
  return { amountMinor: total, currency };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function isZero(money: Money): boolean {
  return money.amountMinor === 0n;
}

export function isNegative(money: Money): boolean {
  return money.amountMinor < 0n;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

/**
 * Scale by an exact rational — a growth rate, a share, a pro-rata slice of a month.
 *
 * Takes numerator and denominator instead of a factor because a factor would be a
 * float, and `runway * 0.1` is the kind of line that puts 0.30000000000000004 on a
 * dashboard. Rounds half-up away from zero.
 */
export function multiplyByRatio(money: Money, numerator: bigint, denominator: bigint): Money {
  if (denominator === 0n) throw new MoneyError('Division by zero in multiplyByRatio');
  const product = money.amountMinor * numerator;
  return { amountMinor: divideRoundHalfUp(product, denominator), currency: money.currency };
}

/**
 * Integer division rounding halves away from zero: 5/2 → 3, -5/2 → -3.
 *
 * "Away from zero" rather than "toward positive infinity" so that a refund of x.005
 * rounds to the same magnitude as the charge of x.005 that produced it. Rounding
 * halves toward positive infinity makes a payment and its reversal fail to cancel,
 * and the discrepancy only shows up as an unexplained penny in a monthly total.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;
  const quotient = absN / absD;
  const remainder = absN % absD;
  const rounded = remainder * 2n >= absD ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Split an amount into `parts` shares that sum back to exactly the original.
 *
 * Largest-remainder: the leftover minor units are handed out one each rather than
 * dropped, because three ways of £10.00 is 3.34/3.33/3.33 and never 3.33/3.33/3.33
 * with a penny unaccounted for.
 */
export function allocate(money: Money, weights: readonly bigint[]): Money[] {
  if (weights.length === 0) throw new MoneyError('allocate requires at least one weight');
  if (weights.some((w) => w < 0n)) throw new MoneyError('allocate requires non-negative weights');
  const total = weights.reduce((acc, w) => acc + w, 0n);
  if (total === 0n) throw new MoneyError('allocate requires at least one non-zero weight');

  const shares: bigint[] = [];
  let distributed = 0n;
  for (const weight of weights) {
    const share = (money.amountMinor * weight) / total; // truncating on purpose
    shares.push(share);
    distributed += share;
  }

  let remainder = money.amountMinor - distributed;
  const step = remainder < 0n ? -1n : 1n;
  for (let i = 0; remainder !== 0n; i = (i + 1) % shares.length) {
    shares[i] = (shares[i] ?? 0n) + step;
    remainder -= step;
  }
  return shares.map((amountMinor) => ({ amountMinor, currency: money.currency }));
}

/**
 * Render for display. **The only place an amount is allowed to become presentation.**
 *
 * `Intl.NumberFormat#format` is handed the exact decimal *string*, never a `number`:
 * passing a number would round-trip through a double and lose precision on any figure
 * above 2^53 minor units, which is a real amount in a low-denomination currency.
 */
export function formatMoney(
  money: Money,
  locale: string = 'en-US',
  options: Intl.NumberFormatOptions = {},
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    ...options,
  });
  return formatter.format(toMajorString(money));
}

/** Compact form for dashboards where the unit is already established. */
export function formatMoneyPlain(money: Money, locale: string = 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: exponentOf(money.currency),
    maximumFractionDigits: exponentOf(money.currency),
  });
  return formatter.format(toMajorString(money));
}
