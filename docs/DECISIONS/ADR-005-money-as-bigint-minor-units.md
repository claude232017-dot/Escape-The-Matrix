# ADR-005 — Money is `bigint` minor units with an explicit currency

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0

## Context

The Ledger is the lagging indicator the entire product is built to correlate against. A man
is being asked to look at a revenue figure and believe it. `0.1 + 0.2 !== 0.3`.

## Decision

Every amount is a `bigint` count of the currency's **minor units**, paired with an ISO-4217
code. Storage is `amount_minor bigint NOT NULL` plus `currency public.currency_code`. There is
no `number` representation of an amount at any layer.

Formatting happens **once, at the edge**, by handing `Intl.NumberFormat` an exact decimal
*string* — the `StringNumericLiteral` overload. Passing a number would round-trip through a
double and lose precision above 2^53 minor units, which is a real amount in a
low-denomination currency.

Currency exponents are per-currency: JPY has none, KWD has three. A hardcoded `100` is a bug
waiting for the first international client.

## Options considered

### A. JavaScript `number` for major units — rejected

**Cost:** it is wrong. Ten thousand entries of 0.07 do not sum to 700, and the error is
invisible until someone reconciles by hand.

### B. Postgres `numeric` with a decimal library on the client — rejected

`numeric` is exact and would be a defensible storage choice.

**Cost:** it arrives at the client as a string and needs a library (decimal.js, big.js) to
be operated on, so the client-side problem is unchanged — and the library's API makes
`new Decimal(0.1)` from a float just as easy as the correct construction. `bigint` is
native, has no dependency, and makes the wrong thing awkward: there is no way to
accidentally get a fractional `bigint`.

### C. Integer minor units as `number` — rejected

**Cost:** works until it does not. `Number.MAX_SAFE_INTEGER` is about 90 trillion yen, and
the failure at the boundary is silent rounding rather than an error.

### D. `bigint` minor units — chosen

**Cost:** three real ones.

1. `bigint` does not serialise to JSON. Every boundary needs an explicit conversion, and
   `fromRow()` exists because the Postgres driver returns `bigint` columns as strings.
2. Arithmetic is verbose: `multiplyByRatio(m, 3n, 100n)` rather than `m * 0.03`. That
   verbosity is the point — it makes the float impossible to write by accident.
3. Division must decide a rounding rule explicitly. Chosen: **half-up away from zero**, so
   a charge and its reversal cancel exactly. Rounding halves toward positive infinity makes
   a payment and its refund differ by a penny, and the discrepancy only ever surfaces as an
   unexplained rounding error in a monthly total.

## Enforcement

- ESLint bans `parseFloat` and `.toFixed` in `src/lib/money.ts` and the ledger feature.
- `add`, `subtract`, `compare` and `sum` throw `CurrencyMismatchError` rather than quietly
  adding USD to EUR — a silent mix is a wrong revenue figure that looks completely normal.
- Four property tests: sum-then-convert equals convert-then-sum; parse∘render is the
  identity across all three exponent classes; addition is order-independent, so a total does
  not depend on the order Postgres returned the rows; `allocate` always reconciles.
