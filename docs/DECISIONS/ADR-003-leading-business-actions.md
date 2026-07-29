# ADR-003 — The leading business actions

**Status:** Proposed — **awaiting the owner's decision**
**Date:** 2026-07-29
**Phase:** 0 (governs Phase 4)

## Context

The protocols are given by the doctrine. These are not. The daily Ledger entry defines what
the circle **optimises for commercially**, and whatever is on this list is what twelve men
will do more of for thirty days. Getting it wrong does not produce a bad dashboard; it
produces a month of the wrong work.

Selection criteria, applied in order:

1. **Leading, not lagging.** A cause he controls today, not an effect that arrives later.
2. **Fully within his control.** He can always do more of it regardless of the market. A
   metric the market can veto teaches learned helplessness on a bad week.
3. **Countable as a small integer.** "Sent 4 offers" says something "did outreach ✓" does
   not. Ticks measure obedience; counts measure volume.
4. **Hard to inflate without doing the work.** Any metric a man can run up by redefining it
   will be run up on the week he is behind.
5. **Few enough to fill in one-handed in under a minute**, alongside the SITREP.

## Decision — six actions

| # | Action | Unit | Why this one |
|---|---|---|---|
| 1 | **Offers made** | count | The most causal action in the entire list. Not "outreach" and not "pitches" — a specific ask for money for a specific thing. It is the number men avoid hardest, which is exactly why it is measured first. |
| 2 | **Conversations held** | count | A real two-way exchange with a potential buyer or partner. Separate from offers because conversations *precede* offers, and a man can hold twenty and ask for nothing. The conversations→offers ratio is where flinching becomes visible. |
| 3 | **Follow-ups sent** | count | Most revenue is in the follow-up, and most beginners send one message and call it dead. It competes for the same hour as new outreach and loses every time, so it gets its own line or it does not happen. |
| 4 | **Deep work blocks** | count (25 min) | The Deep Work protocol's Pomodoro, counted. **This is the bridge between the Forge and the Ledger** — a discipline metric that is also a business input, and therefore the first correlation Phase 6 can test. |
| 5 | **Assets shipped** | count | Something published and finished that persists: a landing page, a video, a piece of software, a written offer. Counts compounding work distinctly from transactional work, so a man who spends a week building does not read as a week of nothing. |
| 6 | **Payments collected** | count | The *event*, not the amount — the amount lives in `money_entries`. Counted separately because invoicing and chasing are themselves avoided actions, and "made a sale" versus "got paid" is the gap that kills small businesses. |

**The seventh slot is left deliberately empty**, for one venture-specific action the owner
adds once he has seen a week of real data. Seven is the ceiling; six leaves room to learn
what is missing rather than guessing now.

## Rejected, and why

| Rejected | Cost of including it |
|---|---|
| **Hours worked** | Measures presence, not output. Rewards the man who sat at the desk longest, which is the exact self-deception the Deep Work protocol exists to break. |
| **Tasks completed** | Self-defined and unbounded — thirty trivial tasks outscore one hard one. Fails criterion 4 completely. |
| **Content posted** | Vanity for most of these businesses and duplicative of "assets shipped" for the rest. Posting is causally tied to revenue for a minority and to dopamine for everyone. |
| **Leads generated** | Not under his control — it is a result, and it arrives or it does not. Belongs on a dashboard, not on a daily input list. |
| **Revenue** | The lagging indicator the whole system is measured *against*. Putting it here would collapse the leading/lagging distinction that Phase 6 exists to exploit. It lives in `money_entries`. |
| **Cold emails / DMs / calls as separate lines** | Three lines that are one behaviour, split by channel. Splitting them lets a man feel busy across three rows while the total stays flat, and it triples the entry cost for no analytical gain. Channel belongs on the venture, not the action. |

## Consequences

- `business_actions` is a **seeded catalogue table**, not an enum, so the owner can revise
  the list without a deploy — the same treatment protocols get.
- `daily_business_entries` is unique on `(profile_id, local_date, venture_id, action_id)`,
  which is also the outbox coalescing key: ten edits to one day produce one queued upsert.
- Counts are `integer`, not booleans. Nothing in the Ledger is a tick.
- **Owner: confirm or replace this list before Phase 4.** It is the one part of the
  commercial doctrine the agent invented rather than encoded.
