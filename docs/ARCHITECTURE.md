# Architecture

Updated per phase. **Current phase: 0 — Foundation and guardrails.**

## What this is

A private operating system for one circle of eight to twelve men running a 30-day
discipline campaign while building income online. Not a product, not a funnel. If a
feature only makes sense at ten thousand users, it does not belong here.

Two loops, and the point is where they meet:

- **The Forge** — protocols, minimum effective doses, the daily SITREP, the debrief.
- **The Ledger** — ventures, leading business actions, revenue, weekly commitments.

Discipline is the leading indicator; money is the lagging one. The correlation between
them is the one thing nothing off the shelf provides, and it is what Phase 6 builds
toward.

## Stack

| Layer | Choice | Note |
|---|---|---|
| Build | Vite 8 + React 18 + TypeScript 6 | `strict`, `noUnusedLocals`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Styling | Tailwind v4, colours as CSS custom properties | Tokens generated from TypeScript — see below |
| Backend | Supabase — Postgres, Auth, RLS | Migrations in `supabase/migrations` |
| Motion | Framer Motion via `LazyMotion` + `domAnimation`, `strict` | Configured once in `src/app/Motion.tsx` |
| Primitives | Radix UI | Real dialogs and menus, not `fixed inset-0` divs |
| Unit tests | Vitest, node environment, `TZ=America/New_York` | |
| DB tests | Vitest against a real Postgres | Migrations applied for each run |
| Browser tests | Playwright, Chromium | Serves the built artifact |
| CI | GitHub Actions | Three jobs: verify, database, browser |

TypeScript is pinned to `~6.0` rather than 7 because `typescript-eslint` caps its peer
range at `<6.1`. See ADR-006.

## Layout

```
src/
  app/              Composition root: App, Motion, build info. Depends on features.
  features/<name>/  A vertical slice. components/, and later hooks/, data/, validation/.
  lib/              Shared primitives. Depends on nothing above it.
  design/           The palette as data, and the CSS generator.
  styles/           global.css, and the GENERATED tokens.css.
scripts/            Build and database tooling, run under plain Node.
supabase/
  migrations/       Applied in filename order. Forward-only.
  local/            The Supabase stand-in used to test migrations locally. Not a migration.
tests/
  unit/             Cross-cutting unit tests (the module graph).
  db/               Migrations and the RLS posture, against real Postgres.
  browser/          Playwright.
docs/
  DECISIONS/        One ADR per non-obvious call.
```

`@/*` aliases `src/*`, from the first commit.

### Dependency rules, enforced by test

`tests/unit/import-graph.test.ts` parses every import in `src/` and asserts:

1. **No cycles.** They fail at module-init time in a file that looks innocent, and the
   bundler's error names the victim rather than the cause.
2. **`lib/` imports nothing from `features/` or `app/`.** The moment it does, it stops
   being a foundation and becomes a second place where feature logic lives.
3. **No feature imports another feature.** Shared code is promoted to `lib/`, `ui/` or
   `design/` instead.
4. **`design/tokens.ts` imports nothing at all**, so the generator can read it under plain
   Node and the contrast suite keeps a single source.

## The bug classes this phase is built to prevent

Each is a bug already paid for in a previous system. Phase 0's job is to make them
impossible to reintroduce unnoticed.

### Dates are local

`src/lib/date.ts` is the only sanctioned way to answer "what day is it?". `toISOString()`
yields the UTC date; a member at UTC-5 would see the day roll over at 19:00, in a product
where midnight is a deadline and a day is a unit of moral accounting.

- `getLocalDateString(tz)` resolves the date in the **member's** zone — from
  `profiles.timezone`, not the browser's guess and not the server's clock.
- `daysBetween` parses both ends as UTC midnight, so a DST transition cannot yield a
  fractional day.
- The campaign day is **derived** from the enrollment's `started_on`, never stored.

Enforced three ways: an ESLint rule banning `toISOString` in application code, a test
asserting the suite is not running in UTC, and 35 assertions covering DST both ways,
half-hour and three-quarter-hour offsets, travel, and a reset mid-campaign.

### Money is integer minor units

`src/lib/money.ts`. Every amount is a `bigint` count of minor units plus an ISO-4217 code.
No `number` representation exists at any layer. Formatting happens once, at the edge, by
handing `Intl.NumberFormat` an exact decimal **string** — passing a number would round-trip
through a double and lose precision above 2^53 minor units.

Currency exponents are per-currency: JPY has none and KWD has three, so a hardcoded 100 is
a bug waiting for the first international client. Four property tests cover
sum-then-convert vs convert-then-sum, parse∘render identity, order-independence, and
allocation reconciliation.

### Rules live in the database

The anon key is public and ships in the bundle. Every rule that matters — who may join,
who may read whose rows, what a valid entry is — is a RLS policy or a database constraint.
Client-side copies exist only to give a fast error before a round trip, and where a rule is
duplicated the comment in each file names the other.

`tests/db/rls-posture.test.ts` applies the real migrations to a real Postgres and
interrogates the catalogue: RLS enabled and **forced** on every table, no table with RLS
and no policy, no unreviewed `USING (true)`, no unconditional write, no grant to `anon`.
Verified by mutation — adding a leaky table makes four of those assertions fail by name.

### Colour is measured, not asserted

`src/design/tokens.ts` is the single source; `src/styles/tokens.css` is generated from it
and a test fails if the two have drifted. Every declared foreground/background pair is
measured against WCAG: 4.5:1 for text, 3:1 for control boundaries. A colour with no
declared usage fails the suite, so nothing reaches a screen unmeasured — and `decorative`
cannot be used as an escape hatch, because the tokens allowed to carry it are themselves a
declared list.

The same file names the font stacks, and the same suite holds them to the same standard: a
quoted, non-system family must have a matching `@font-face` in `src/styles/fonts.css`, which
must load from this origin and must not block first paint. `'Inter'` sat in that stack from
Phase 0 to Phase 9 with nothing anywhere loading it — see ADR-014.

### The rain marks the door, and stays there

`src/app/MatrixRain.tsx` is mounted on the threshold screens only — sign-in, reset, the
disclosure. It is deliberately absent from every screen inside the app: the SITREP carries a
filing gate the browser suite *measures* at sixty seconds, and moving glyphs behind that
decision are interference rather than atmosphere.

Confinement is enforced two ways, because one of them has a hole. `tests/browser/header.spec.ts`
loads every harness route and asserts the canvas is absent — which covers each screen and
misses the case that would actually happen, a single `<MatrixRain />` added to `SignedInShell`
one level above them all, where no harness can reach. `tests/unit/rain-confinement.test.ts`
reads the import graph and fails on any importer outside a declared allow-list, which catches
it wherever it is mounted.

Under `prefers-reduced-motion` the canvas paints a **still frame** rather than nothing: the
usual reading throws the whole look away for people whose preference is about vestibular
discomfort rather than taste, and a frozen field costs them nothing. The global CSS rule cannot
reach a `requestAnimationFrame` loop, so this is explicit — and the test counts painted glyph
pixels, because an earlier version of it passed a mutation that deleted the drawing entirely.

## Data flow (from Phase 1)

```
React component
  → feature hook
    → feature data module  ─ validates against the same rules as the SQL constraint
      → outbox (Phase 2)   ─ coalescing, persisted, SQLSTATE-classified
        → Supabase client  ─ anon key
          → PostgREST
            → RLS policy   ← the actual enforcement boundary
              → Postgres
```

## Still to come

Phase 9 hardening — done. Nothing in the original plan is outstanding.

Shipped: Phase 1 identity and invitations; Phase 2 the Forge and the durable outbox; Phase 3
the debrief and the war log; Phase 4 the ledger; Phase 5 the weekly commitments; Phase 6 the
Commander's View and the correlation engine; Phase 7 playbooks; Phase 8 export, deletion and the service worker; Phase 9 hardening.
