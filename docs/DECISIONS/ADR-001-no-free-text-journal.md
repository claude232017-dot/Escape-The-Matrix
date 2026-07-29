# ADR-001 — No free-text journal

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0 (governs Phase 3)

## Context

The circle already runs its campaign in a chat channel: daily protocols, a daily report, a
written debrief, all as prose. Thirty days times twelve men is roughly seven hundred
written reports.

Those reports are **unaggregatable**. Nobody can answer "what time of day does the enemy
attack?", "which protocol fails most often in week three?", or "do the weeks with five
deep-work blocks correlate with the weeks money came in?" The raw material for a lifetime
of self-mastery is sitting there and it is unreadable.

That is the entire justification for building this app rather than continuing in chat.

## Decision

**No free-text journal anywhere in the product.** No daily entry, no "reflection" box, no
notes field on a task. Everything reflective is schema'd: enums, capped fields, named
triggers.

Concretely, the debrief is:

- **Top G Insight** — `system_used` (≤140), `victory` (≤140), `protocol_id`
- **Bottom G Tactic** — `occurred_at_hour` (0–23), `trigger_kind` (enum), `propaganda`
  (≤140), `protocol_id`, `outcome` (enum)

The cap is enforced by `app.capped_text_140` in the database, not only in the UI.

## Options considered

### A. Free-text journal — rejected

The familiar shape, and what the circle already has.

**Cost:** it produces nothing queryable, which means the app's central promise
evaporates — capture without surfacing is just a prettier chat channel. It also creates a
psychological debt: a blank textarea becomes a diary nobody rereads, and after three missed
days the accumulated blankness is what makes men stop opening the app at all.

### B. Structured fields plus an optional free-text box — rejected

The obvious compromise, and the one most likely to be proposed later.

**Cost:** the box wins. Given a structured form and a blank box, people write the prose and
skip the enums, because prose is easier and feels more honest. The structured fields then
carry sparse, unreliable data — worse than not having them, because the aggregate queries
now silently under-report. The compromise gives up the benefit of both designs.

### C. Fully structured — chosen

**Cost, stated honestly:** some genuine nuance is lost. A man will occasionally have
something to say that does not fit `trigger_kind`, and `other` is a poor home for it. The
schema will need revising as the circle discovers what it actually wants to record — and
because the fields are typed, that revision is a migration rather than a re-read of seven
hundred paragraphs.

The nuance loss is real. It is the price of being able to say "low energy beats you 7 times
in 10, stress only 2 in 10", which no volume of prose will ever tell him.

## Consequences

- Phase 3 must build **capture and surfacing together**. Capture alone is the failure mode
  this ADR exists to prevent.
- The weak/strong examples from the doctrine are shown as placeholder guidance in the UI,
  because the difference between "had a good workout" and "laying out gym clothes the night
  before eliminated the friction" *is* the schema, and men need to see it at the moment
  they type.
- If the owner asks for a free-text box anyway, it gets built — it is his product. This
  ADR is what the conversation should start from.
