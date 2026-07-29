# ADR-009 — The mentor sees full protocol detail, disclosed at enrollment

**Status:** Accepted — owner's decision, 2026-07-29
**Date:** 2026-07-29
**Phase:** 0 (governs Phases 1, 2 and 6)

## Context

The app records, per identified individual, compliance with a sexual-discipline protocol
and with substance-use prohibitions. Under GDPR the first is **special-category data**
(Article 9, data concerning a person's sex life). The circle is a dozen men who know each
other, so every row is attributable and the harm from mishandling is concentrated and
personal.

The mentor is not a platform operator. He is a man in the room who these members already
talk to about this material. But "we already talk about it" is not the same as "a database
holds it, itemised, queryable, and visible on a dashboard" — and the gap between those two
is exactly where consent gets assumed rather than obtained.

## Decision

**The mentor sees full detail, itemised. Every member is told so at enrollment, in plain
words, before he files anything.**

Peers do not: sensitive protocols default to `aggregate_only` and contribute only to the
day's status.

The disclosure is a **blocking step in the enrollment flow**, with acceptance recorded as
`enrollments.disclosure_accepted_at` and `disclosure_version`. It is re-shown when the
disclosure text materially changes.

## Options considered

### A. Mentor sees the same as peers — rejected

Day status and aggregate compliance only; sensitive protocols never itemised to anyone.

**Cost:** the mentor cannot see the specific pattern he is best placed to help with. A man
losing to the same trigger at the same hour every week is precisely the thing a mentor
should be able to name, and this option makes that invisible to the one person who could
act on it. It also makes the Phase 6 correlation engine substantially weaker.

### C. Member chooses per protocol — rejected

Opt-in per protocol, defaulting to aggregate.

**Cost:** uneven data across the circle, which the Commander's View then has to render
without making the gap itself read as a confession. A man who opts out of showing his
sexual-discipline protocol has, by opting out, said something about it — in a group of
twelve where everyone can see who did what. The choice is not private, so it is not really
a choice.

### B. Full detail, disclosed — chosen

**Cost, accepted knowingly:** some men will under-report the sensitive protocols once they
know the mentor sees them itemised. That degrades the honesty of the dataset in exactly the
area where honesty matters most, and there is no technical mitigation that does not make it
worse (see below).

## Why the disclosure is load-bearing

The access level is not what makes this legitimate — the disclosure is. A silent version of
this decision, where the mentor has full detail and members assume the peer rules apply to
him too, is **the only genuinely wrong answer available**, and it is also the easiest one to
ship by accident: it requires nothing but forgetting to build the enrollment screen.

Every requirement in `docs/SECURITY.md` §3 exists to make that accident impossible.

## What must not be built

A detector for suspected under-reporting.

The signal exists and is easy to compute — a perfect sexual-discipline record from Day 1
alongside normal variance everywhere else. Building it would put a machine in the position
of accusing a man of lying to his mentor, which destroys precisely the trust the disclosure
was meant to establish, and it would do so on evidence that is merely suggestive.

It is a thing for the mentor to notice and raise in person, or not.

## Consequences

- Phase 1 gains a blocking enrollment disclosure and two columns. This is scope the phase
  did not previously have.
- Phase 2's `protocols.visibility` still exists and still defaults sensitive protocols to
  `aggregate_only` — that default now governs **peers**, not the mentor.
- Phase 6's mentor queries may read itemised sensitive results, enforced by RLS predicates
  on `profiles.role = 'mentor'` within the same circle — never by hiding UI.
- Phase 9 must assert that no protocol detail reaches any third-party analytics, error
  reporter or log aggregator. Mentor access is a deliberate, disclosed exception for one
  named person; a logging vendor is not.
