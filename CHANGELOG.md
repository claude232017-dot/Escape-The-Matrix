# Changelog

## Phase 0 — Foundation and guardrails

The goal of this phase was not features. It was to make a specific list of bug classes
impossible to introduce unnoticed, so that later phases can move quickly without
reintroducing failures that have already been paid for once.

### Added

**Local-date handling** (`src/lib/date.ts`). Calendar dates are resolved in the member's
own timezone, never from `toISOString()` and never from the browser's guess. Day counts,
week boundaries and SITREP deadlines all derive from it, and the campaign day is computed
from the enrollment's start date rather than stored as a counter. 35 assertions cover DST
in both directions, half-hour and three-quarter-hour offsets, a travelling member, a
missed day, and a reset mid-campaign.

**Money as integer minor units** (`src/lib/money.ts`). Every amount is a `bigint` count of
minor units plus an ISO-4217 code, with per-currency exponents so JPY and KWD are not
wrong. Formatting happens once, at the edge, from an exact decimal string. Four property
tests, including the required sum-then-convert vs convert-then-sum.

**A measured colour palette** (`src/design/`). Colours live in TypeScript; the stylesheet
is generated from them and a test fails on drift. Every declared foreground/background pair
is measured — 4.5:1 for text, 3:1 for control boundaries — and a colour with no declared
usage fails the suite.

**Migrations with a tested security posture** (`supabase/`, `tests/db/`). The baseline
migration establishes default-deny at the schema level. The test suite applies the real
migrations to a real Postgres and asserts RLS is enabled and forced everywhere, no table
has RLS without a policy, no `USING (true)` is unreviewed, no write policy is
unconditional, and `anon` holds no grants.

**Structural guardrails** (`tests/unit/import-graph.test.ts`). No import cycles, `lib`
never depends on a feature, features never reach into each other, and the token module
imports nothing.

**The application shell.** Vite 8, React 18, TypeScript 6 strict, Tailwind v4, Framer
Motion via `LazyMotion` with reduced motion honoured globally in one place. Renders with no
console errors and no horizontal overflow at 320, 360, 390, 430, 768, 1024, 1280, 1440 and
1920 px.

**CI** (`.github/workflows/ci.yml`). Three jobs — verify, database, browser. The preview
server binds the literal address the runner polls, and the browser job consumes the built
artifact rather than rebuilding inside its readiness budget.

**Documentation.** Architecture, data model, doctrine, security, runbook, and eight ADRs
recording what was rejected and what it cost.

### Verified

- `npm run verify` passes from a clean clone: 120 unit tests, 11 database tests.
- 16 browser tests pass against the built artifact.
- Four guardrails confirmed by **mutation** — reintroducing the bug makes the test fail:
  removing the `TZ` pin, hand-editing the generated stylesheet, and adding a leaky table
  (which fails four RLS assertions by name).
- `npm audit`: 0 vulnerabilities across 267 packages.

### Deliberately not done

- No auth, no user data — Phase 1.
- No durable outbox — Phase 2, where it is needed and can be tested against a real
  offline scenario.
- No service worker — Phase 8. Shipping one before there is anything to cache would mean
  building the update prompt against a shell nobody uses.
- No `ui/` primitives directory. Radix is installed but unused; the first real dialog
  earns the abstraction.

### Known gaps

- `docs/DOCTRINE.md` is a **draft**. Six assumptions are marked `[ASSUMED]` and the code
  already behaves as though they are true. They need the owner's correction before Phase 2.
- The mentor-visibility question in `docs/SECURITY.md` §3 is unanswered and blocks the
  Phase 2 visibility model.
- The business-action list in ADR-003 is the agent's proposal, not the owner's doctrine.
- The contrast suite measures declared pairs. A developer can still put an undeclared
  *combination* of two already-declared colours on screen. See ADR-007.
