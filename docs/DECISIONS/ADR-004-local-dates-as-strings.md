# ADR-004 — Calendar dates are zone-resolved strings, not `Date` objects

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0

## Context

In this product a day is a unit of moral accounting and midnight is a deadline. If a
member's day rolls over at the wrong hour, his SITREP files against the wrong date, his
campaign day is off by one, and his week boundary moves. That is not a rounding error.

The failure mode is specific and extremely easy to reintroduce: `new
Date().toISOString().slice(0, 10)` yields the **UTC** date, so a member at UTC-5 sees the
day roll over at 19:00 local.

## Decision

A calendar date is an `IsoDate` — a `YYYY-MM-DD` **string** — resolved in the member's own
timezone from `profiles.timezone`, by `getLocalDateString(tz)` in `src/lib/date.ts`. It is
never a `Date`, and never the browser's guess.

`daysBetween` parses both ends as **UTC midnight**, so a DST transition between them cannot
produce a 23- or 25-hour day and therefore cannot yield a fractional result. Two calendar
dates are always a whole number of days apart; that is a property of the calendar, and this
implementation keeps clock arithmetic away from it.

## Options considered

### A. `Date` objects throughout — rejected

**Cost:** a `Date` is an instant, not a date. Every use has to remember which zone it is
being interpreted in, and the default is whatever the machine says. This is the design that
produces the bug.

### B. `timestamptz` in the database, cast to `date` on read — rejected

**Cost:** it moves the same bug server-side and makes it harder to see. The cast happens in
whatever zone the connection has, which is UTC on Supabase, so the rollover error reappears
in every aggregate query — including the war log, where it would silently shift attack hours
across a day boundary.

### C. A date library (`date-fns`, Luxon, `Temporal`) — rejected for now

**Cost:** `Temporal` would be the right answer and is genuinely better than this module. It
is not yet available across the runtimes this has to work on without a polyfill, and the
polyfill is larger than the whole of `date.ts`. The full-fat libraries bring far more API
than five functions' worth of need, and none of them prevents someone reaching for
`toISOString()` anyway.

**Revisit when `Temporal` ships natively.** `date.ts` is ~50 lines of real logic behind a
small interface, so the migration is contained.

### D. Zone-resolved `IsoDate` strings — chosen

**Cost:** strings are not type-safe against each other — `IsoDate` is an alias for `string`,
so nothing stops a caller passing an arbitrary string. Mitigated by validating at every
entry point and throwing `InvalidDateError`, which is checked in tests. A branded type was
considered and rejected as more ceremony than it buys when the values cross the network as
JSON anyway.

## Enforcement

Three independent layers, because one is not enough for a bug this easy to reintroduce:

1. An **ESLint rule** banning `toISOString` in application code, naming the alternative.
2. A **test that asserts the unit suite is not running in UTC** — verified by mutation:
   removing the `TZ` pin fails that test and only that test.
3. **35 assertions** in `src/lib/date.test.ts` covering DST in both directions, half-hour
   and three-quarter-hour offsets, a travelling member, a missed day, and a reset
   mid-campaign.
