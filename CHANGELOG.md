# Changelog

## Phase 1.1 — Groundwork the Forge needs

Not a phase. Three things that had to exist before Phase 2 rather than alongside it.

### Added

**A profile screen.** Three of Phase 2's minimum effective doses reference member-specific
artefacts — the **Top G Code** (which the Morning Protocol MED shows inline at the moment it
asks him to read it aloud), the **Command Post**, and the **Fortress Protocol** — and there was
no way to write any of them. The columns existed; the screen did not. Building it now means
Phase 2 starts with the data it needs instead of stubbing around it.

**The timezone is editable.** It could previously only be set at signup, and there was no
remedy for getting it wrong. That stops being cosmetic the moment the Forge writes dates against
it: a man on Asia/Beirut left as UTC would have everything filed between midnight and 3am land on
the previous day. Capped textareas show remaining characters, because the caps are database
constraints and discovering one after pressing Save is a bad way to learn it.

**An error boundary.** A render throw previously produced a blank document — no message, no way
out, nothing to relay. It now names what happened, says explicitly that filed work is not lost,
shows the technical line rather than hiding it behind a toggle, and offers a reload. It
deliberately reports nowhere: any future error reporter must not receive protocol detail
(`docs/SECURITY.md` §2), and a boundary is the easiest place in the codebase to leak it by
accident. That is a Phase 9 job with a scrubbing test attached.

### Documentation debt closed

`docs/DATA-MODEL.md` still described Phase 1's tables as planned when they had shipped, and its
header still claimed `FORCE` RLS on every table — which Phase 1 had already contradicted. Both
corrected, with every column, constraint, policy and grant now recorded.

Two decisions had been made in commit messages and test comments but never as ADRs:

- **ADR-010** — reversing the blanket `FORCE` RLS rule, and why the alternative (a permissive
  policy to let the signup triggers through) would have been strictly worse.
- **ADR-011** — `app.circle_membership`, the denormalisation that breaks RLS recursion, including
  why the JWT-claim approach was rejected and when it would be worth revisiting.

### Structural

Profile-field validation and the timezone list moved to `lib`. Both are needed by `auth` at
signup and by `profile` afterwards, and a feature importing another feature is the knot the
import-graph test rejects — it caught this twice before the fix stuck, including once when the
dependency had merely been hidden behind a re-export.

### Verified

225 unit tests, 47 database tests, 35 browser tests. `npm run verify` green.

### Known gaps

- The error boundary's *wiring* is not covered by an automated test — only the pure message
  derivation is. Triggering a real render crash needs either a component-test environment
  (jsdom, which the suite deliberately does not have) or a deliberate crash mechanism shipped in
  the bundle. Stated rather than papered over.
- No profile screen coverage in the browser suite: it only renders behind a session, and the
  browser tests run without Supabase credentials by design.

## Phase 1 — Identity, circle, invitations

**Goal: the right men get in and nobody else does.** Enforced in Postgres, because the anon
key is public and anything checked only in the browser is decoration.

### Added

**Three tables and two triggers** (`0002_identity.sql`). `circles`, `profiles`,
`invitations`. The `auth.users` triggers are deliberately separate because their obligations
are opposite: the invite check **raises** (an uninvited address must not get an account),
profile creation **never raises** (a missing profile is recoverable; an uncreatable auth user
is not, and GoTrue reports it as an opaque "Database error saving new user" and then
"already registered" on every retry).

**Privilege escalation blocked by a column-level grant**, not a policy. `WITH CHECK` cannot
see `OLD`, so it cannot express "role must not change"; `role` and `circle_id` are simply not
in `GRANT UPDATE`, and the privilege system rejects the attempt before any policy runs.

**`app.circle_membership`**, a small denormalisation in the ungranted `app` schema. An RLS
policy on `profiles` asking "is this row in my circle?" must read the reader's circle from
`profiles` — infinite recursion, which Postgres reports without naming the policy. Reading it
from elsewhere breaks the cycle by construction.

**The recovery hold** (§3.7). The reset screen is pinned from the **first paint**, decided
synchronously from a URL parameter we control rather than awaited from the auth library, and
`PASSWORD_RECOVERY` is handled explicitly. Recovery outranks every other view including a
fully valid session — a recovery link creates a real session, so if anything else could win,
the emailed link would be a standing credential for whoever can read the inbox.

**Sign-out clears local state** (§3.8). Keys are namespaced `etm:<userId>:<name>` and the
signing-out member's namespace is emptied. Scoped to him rather than wiping everything: on a
shared device another member's queued work is his, will only flush under his own session, and
destroying it would lose a SITREP he believes was saved.

**The enrollment disclosure** (ADR-009), as a blocking step with recorded acceptance. It
states in plain words that the mentor sees protocol detail in full, including the
sexual-discipline and substance protocols. A `CHECK` rejects a timestamp with no version,
because that cannot answer what he actually agreed to.

**Screens**: sign-in (no signup form — membership comes from an invitation), reset, disclosure,
a named `profile-missing` screen for the orphaned-profile failure, and the mentor's invitation
list. Invitation tokens come from `crypto.getRandomValues`, never `Math.random`.

### Verified

- 185 unit tests, 44 database tests against real Postgres with real JWT claims, 25 browser
  tests. `npm run verify` green.
- Uninvited signup rejected at the **API boundary** — a direct `insert into auth.users`, which
  is what GoTrue itself does.
- Member A gets **zero rows** from member B, every table, every verb.
- `0002` applies cleanly three times in a row.
- **Mutation-tested.** Four bugs reintroduced one at a time: `USING (true)` (3 tests fail),
  `role`/`circle_id` added to the update grant (2), invite check downgraded to a warning (3),
  and recovery losing its priority in the view resolver (2 unit + 5 browser).

### Corrected from Phase 0

The RLS guardrail asserted `FORCE` on every table. `FORCE` makes the owner subject to
policies, and the owner is who `SECURITY DEFINER` functions run as — so the signup triggers
could not read `invitations` or insert a profile, and **every signup would fail**. `FORCE` is
not load-bearing here because application traffic never arrives as the owner. Replaced with a
reasoned exemption list that is itself asserted to be neither stale nor widened.

### Known gaps

- The disclosure text is not yet versioned against a stored copy, so a past acceptance
  resolves to a version string rather than to the exact wording. Phase 2.
- No rate limiting on auth beyond Supabase's defaults. Phase 9.
- `docs/DOCTRINE.md` §10 still has four open questions; protocol activation days block the
  Phase 2 seed migration.

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
