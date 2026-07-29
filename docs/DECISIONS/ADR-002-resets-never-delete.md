# ADR-002 — Keep the campaign reset; never delete history

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0 (governs Phase 2)

## Context

An act of treason — a breach of the sexual-discipline oath, or a zero day of three or more
failed active protocols — returns the campaign day count to Day 1. A man on Day 27 loses
twenty-seven days of visible progress.

This is a **self-reported** system. Nobody audits whether the push-ups happened. So the
reset creates a direct incentive to lie, and a dishonest SITREP is worse than no SITREP: it
corrupts the very dataset the product exists to build.

## Decision

**Keep the reset exactly as the doctrine states it.** Do not soften it.

**Implement it as a new `enrollments` row** whose `previous_enrollment_id` points at the one
it replaces. Nothing is deleted, nothing is decremented, and the campaign day is a *derived*
value — days since the current enrollment's `started_on`.

A `reset_events` row records the date, the kind, the reason and which protocols were failed.

## Options considered

### A. Streaks without a reset — rejected

An earlier draft of the specification argued against streak mechanics outright: they punish
one bad day with total loss and push people toward quitting or lying.

**Why rejected:** the MED doctrine is a direct answer to that objection and a better one
than dropping streaks. Because the minimum effective dose earns a legitimate pass, a bad day
does not cost the streak — only a *zero* day does, and "the only true failure is zero" is
the circle's own rule. Removing the reset would remove the stakes, and the stakes are the
owner's to set, not the agent's to quietly file down.

### B. Reset by decrementing or clearing a counter — rejected

The simplest implementation.

**Cost:** it destroys history. The twenty-seven days of protocol results, debriefs and
attack-hour data are the most valuable thing the man has produced, and they become
unreachable at exactly the moment they would be most instructive. It also makes the
correlation engine impossible to build honestly, because the record has holes wherever
someone failed.

### C. Reset as a new enrollment row — chosen

**Cost:** every query about "the current campaign" must scope to the current enrollment,
and every query about "everything he has ever done" must walk the `previous_enrollment_id`
chain. That is a permanent tax on query complexity, paid on every feature from Phase 2
onward.

Worth it. The alternative is a product that deletes a man's record of his worst month, which
is the month with the most to learn from.

## The honesty problem, stated plainly

The incentive to lie **cannot be removed without removing the stakes**. What the design does
instead is make honesty cheap to afford:

1. History is never destroyed, so a reset costs progress but not the record.
2. A reset is displayed as a **fact**, not a verdict — no red banner, no shaming copy.
3. The reason is captured as data, so patterns in resets become visible the same way
   patterns in attacks do. A man who resets three times on a Friday night has learned
   something.

**This was raised with the owner at Phase 2 as required. The rules were not softened on the
agent's initiative.**

## Consequences

- `campaignDay(startedOn, today)` is a pure function of two dates. There is no counter
  anywhere in the schema, and a test asserts the previous enrollment and its SITREPs remain
  readable after a reset.
- Phase 2 must prove non-destruction with an actual assertion, not an inspection.
