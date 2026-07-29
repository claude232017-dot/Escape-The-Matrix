# Escape The Matrix

A private operating system for a small circle of men running a disciplined campaign to
build income online.

Not a product. Not a funnel. There is no signup, no growth loop, and no viral mechanic —
it is a tool for one mentor and the eight to twelve friends he is actually helping get out
of jobs they hate and into businesses they own.

## What it is for

The circle already runs a 30-day campaign: daily protocols, a daily report, a written
debrief. It runs on prose posted into a chat channel.

Thirty days times twelve men is roughly seven hundred written reports, and in a chat
channel they are **unaggregatable**. Nobody can answer "what time of day does the enemy
attack?", "which protocol fails most often in week three?", or "do the weeks with five
deep-work blocks correlate with the weeks money came in?"

This app turns that prose into queryable intelligence. Two loops:

- **The Forge** — protocols, minimum effective doses, the daily SITREP, the debrief.
- **The Ledger** — ventures, leading business actions, revenue, weekly commitments.

Discipline is the leading indicator. Money is the lagging one. The correlation between
them — showing a man, from his own data, that his revenue weeks are the weeks he held the
line — is the one thing nothing off the shelf provides, and it is what the whole schema is
built toward.

## Status

**Phase 0 of 9 — Foundation and guardrails.** Complete and verified.

There is no login and no user data yet. What exists is the machinery that makes a
specific list of bugs impossible to reintroduce unnoticed: local-date handling, integer
money, a measured colour palette, migrations with a tested RLS posture, and CI.

See `CHANGELOG.md` for what each phase delivered, and `docs/ARCHITECTURE.md` for how it
fits together.

## Running it

Requires Node 22+.

```bash
npm ci
cp .env.example .env.local     # fill in the Supabase values
npm run dev
```

### The gate

```bash
npm run verify     # typecheck → lint → unit tests → database tests → build
```

This must pass from a clean clone. The database tests skip if `DATABASE_URL` is unset; to
run them:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres --name etm-db postgres:16
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
npm run db:test
```

### Browser tests

```bash
npm run build
npx playwright install chromium
npm run test:browser
```

### Other commands

| Command | What it does |
|---|---|
| `npm run tokens:build` | Regenerates `src/styles/tokens.css` from `src/design/tokens.ts` |
| `npm run db:apply` | Applies migrations to `DATABASE_URL` |
| `npm run test:watch` | Unit tests in watch mode |

## Deploying

Vercel, preset Vite, build `npm run build`, output `dist`. Set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`.

**Apply migrations before deploying code that depends on them.** See `docs/RUNBOOK.md`.

## Documentation

| File | What is in it |
|---|---|
| `docs/DOCTRINE.md` | The encoded rules — protocols, the MED, failure states, day counting. **The source of truth when code and memory disagree.** Currently a draft awaiting the owner's correction. |
| `docs/ARCHITECTURE.md` | Layers, data flow, the bug classes the foundation prevents |
| `docs/DATA-MODEL.md` | Every table and constraint, shipped and planned, with the reasoning |
| `docs/SECURITY.md` | The RLS matrix and the sensitive-data handling table. **The owner needs to read §3.** |
| `docs/RUNBOOK.md` | Deploy, migrate, roll back, and the failures that present as something else |
| `docs/DECISIONS/` | One ADR per non-obvious call, including what was rejected and what it cost |

## Two things the owner needs to decide

1. **`docs/SECURITY.md` §3** — how much of a member's protocol detail the mentor sees. This
   is special-category data under GDPR and the answer changes what Phase 2 builds.
2. **`docs/DECISIONS/ADR-003`** — the six leading business actions. The protocols come from
   the doctrine; this list does not, and it defines what the circle optimises for
   commercially.

`docs/DOCTRINE.md` §10 lists the assumptions the code already depends on, in priority
order. They should be corrected before Phase 2.
