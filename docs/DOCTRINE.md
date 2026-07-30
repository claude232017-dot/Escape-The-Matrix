# Doctrine

**Version:** `2026.07-draft`
**Status:** DRAFT — awaiting the owner's correction. Nothing downstream should be treated
as settled until he has been through it.
**Stored as:** `app_meta.doctrine_version`, and later `campaigns.ruleset_version`.

This document is the source of truth when the code and somebody's memory disagree. It is
versioned because the rules will be tuned between campaigns, and a year from now nobody
will remember why a zero day is three protocols rather than two.

> **How to read this.** Everything below is an encoding of the circle's existing Rules of
> Engagement into rules a database can check. Where the source was explicit, it is
> reproduced. Where it was silent and the code needed an answer anyway, the line is
> marked **[ASSUMED]** — those are the ones to correct first, because the code already
> behaves as if they were true.

---

## 1. The two figures

Every entry in the system is a vote for one of two men.

| | **Top G** | **Bottom G** |
|---|---|---|
| Builds | Consumes |
| Owns outcomes | Negotiates |
| Keeps his word to himself | Blames |
| Is the cause | Is the effect |

This vocabulary is used in the interface, not translated into softer language. It does
real work: it externalises failure. "I am lazy" is shame, and shame is paralysis. "The
enemy attacked at 15:00 using tiredness" is intelligence, and intelligence has a
counter-measure. The debrief schema (§6) exists to make the second sentence the only one
the app will accept.

The saboteur figure is named **Bottom G** and nothing else. The source material tags him
with a rainbow flag emoji; that is not carried across. It aims at a group of people
rather than at the behaviour, it does no work the word "saboteur" is not already doing,
and it is the kind of thing that becomes a screenshot.

---

## 2. Protocols

A **protocol** is a daily duty or prohibition.

- **Duty** — something that must be done. Failing to do it is a fail.
- **Prohibition** — something that must not be done. Doing it is a fail.

Protocols are introduced progressively across a campaign. Each carries an
`activates_on_day`; a protocol that is not yet active **cannot be failed and is not
shown**. Protocols are mentor-editable data, not hardcoded — the list below is seeded by
migration and can be changed without a deploy.

### 2.0 Activation schedule

Settled by the owner, 2026-07-30. Five waves across the thirty days.

| Day | Goes live | Reasoning |
|---|---|---|
| **1** | Morning Protocol · the SITREP · **sexual-discipline oath** · pornography & masturbation · video games | The floor. The oath is day one because it is the treason trigger; the Morning Protocol is five minutes, so no ramp is needed. |
| **4** | Physical Forging · Deep Work | Deep Work needs his Fortress Protocol written first. Physical Forging is heavy, but its Option B MED makes it survivable immediately. |
| **8** | Junk food · alcohol & recreational drugs | Week two. Diet and drink are social, so they need a week of momentum behind them. |
| **15** | Evening Power-Down / Digital Sunset · binge-watching | Week three. The hardest habit change, and the one this doctrine predicts men fail most. |
| **22** | Mindless social media & news scrolling | Week four. Needs the explicit work-use rules written down first, or it is unenforceable. |

Consequence worth noting: on **day 1 only three protocols are live**, so three failures is
all of them — and under the current zero-day threshold that is an act of treason. See §10.

Each protocol has:

| Field | Meaning |
|---|---|
| `slug` | Stable identifier, never reused |
| `label` | What it is called |
| `nickname` | The circle's name for it, e.g. "The 5-Minute Victory" |
| `kind` | `duty` or `prohibition` |
| `category` | Physical, digital, nutritional, sexual, work |
| `activates_on_day` | First campaign day on which it is live |
| `visibility` | `itemised` or `aggregate_only` — see §7 |
| `is_treason_trigger` | Whether breaching it is an act of treason (§5) |
| `med_options` | One **or more** alternatives, any one of which earns a MED pass |

### 2.1 The seeded catalogue

These four are the named protocols with their exact MEDs as the circle currently defines
them.

| Protocol | Nickname | MED |
|---|---|---|
| **Physical Forging** | — | **Option A:** 100 push-ups **and** 200 bodyweight squats, may be broken up across the day. **Option B:** a 20-minute non-stop run or brisk walk. Either one, not both. |
| **Morning Protocol** | The 5-Minute Victory | Go to the Command Post, drink one full glass of water, read the Top G Code aloud, perform 20 push-ups. |
| **Deep Work** | The 25-Minute Sprint | One 25-minute completely uninterrupted Pomodoro on the most important task, under Fortress Protocol rules. |
| **Evening Power-Down** | The 15-Minute Shutdown | Digital Sunset (all screens off) is non-negotiable; at minimum 15 minutes with a physical book before sleep. |

Note the shape of Physical Forging: **a MED can be a choice between alternatives.** This
is why `protocol_med_options` is its own table rather than a text column — a single
column would force the either/or into prose that the interface could not then present as
a genuine choice, and the app could not record which option a man actually took.

### 2.2 Prohibitions in the current ruleset

- Pornography and masturbation
- Mindless social media and news scrolling — work use permitted under explicit rules
- Binge-watching
- Junk food
- Alcohol and recreational drugs
- Video games

### 2.3 Duties in the current ruleset

- The Morning Protocol
- The Daily Mission
- The SITREP itself
- Nutrition, digital and physical protocols as they are introduced

### 2.4 Member-specific artefacts

Three MEDs reference things that belong to the individual, not the campaign:

| Artefact | What it is | Where it lives |
|---|---|---|
| **Command Post** | His physical workspace | `profiles.command_post_note` |
| **Top G Code** | His personal creed, read aloud | `profiles.top_g_code` |
| **Fortress Protocol** | His rules for uninterrupted work | `profiles.fortress_protocol` **[ASSUMED]** — the source names the concept but does not say it is written down per man |

The Morning Protocol MED **displays his own Top G Code inline**, at the moment it is
meant to be read. A MED that says "read your Code aloud" without showing the Code is
friction at exactly the wrong moment — the low-energy morning it exists to rescue.

---

## 3. The Minimum Effective Dose

> The MED is the pre-defined bare minimum that earns a legitimate **pass** on a day of
> chaos, sickness or disruption. It is a win, not a lesser pass.
> **The only true failure is zero.**

This is the most important mechanic in the document and the one that makes the system
survivable. It is encoded exactly as stated:

- A MED pass **counts as a pass** for campaign continuity. It does not break a streak, it
  does not repeat the day, it does not count toward a zero day.
- It is **stored distinctly** (`protocol_results.status = 'med_pass'`, plus which option
  was used) so the difference is visible in analysis.
- The difference is **never** visible as judgement. No screen ranks a `med_pass` below a
  `pass`, and no colour treats it as a partial failure. It is amber because it is
  informative, not because it is a warning.
- The MED text is shown **inline, on the same screen as the pass/fail control** — at the
  point where a man is deciding whether to write the day off. That is the moment the
  doctrine has to be in front of him, not buried in a rules page.

---

## 4. The day

- A **campaign day** is a calendar date resolved in the **member's own timezone**
  (`profiles.timezone`). A man who travels does not lose a day.
- The enrollment's `started_on` is **Day 1**, not Day 0.
- The day count is **derived** — days since the current enrollment's start — never a
  stored counter.
- The **SITREP deadline is local midnight.** Confirmed by the owner, 2026-07-29. A report
  filed at 01:30 counts for the **new** day, and the day just ended is closed. There is no
  grace window: a man who files at 00:30 has missed the previous day, and that is the
  intended reading — the deadline is the point of the mechanism.
- A day with no SITREP is still a day of the campaign. Silence does not pause the clock.

---

## 5. Failure states

Two tiers, and the app distinguishes them.

### 5.1 Tactical failure

**One or two** active protocols failed in a day.

- The day is **lost and repeated**.
- The campaign continues; the enrollment is untouched.
- `sitreps.final_status = 'repeat'`.

### 5.2 Act of treason

Either of:

- a breach of the **sexual-discipline oath**, or
- a **zero day** — **three or more** active protocols failed.

Consequence: the campaign day count returns to **Day 1**.

### 5.3 What a reset actually does

**A reset never deletes anything.**

It creates a **new `enrollments` row** whose `previous_enrollment_id` points at the one it
replaces. The chain stays intact, every prior SITREP and debrief remains readable, and the
day count falls out of the new row's `started_on`. There is no counter to decrement and no
history to destroy.

A `reset_events` row records the date, the kind (`treason` or `zero_day`), the reason, and
which protocols were failed — so patterns in resets become visible in the same way
patterns in attacks do.

> **Open question for the owner — raised at Phase 2, not decided here.**
> A self-reported system where failure costs twenty-seven days of visible progress creates
> a real incentive to lie, and a dishonest SITREP is worse than no SITREP: it corrupts the
> dataset the whole product exists to build. That incentive cannot be removed without
> removing the stakes, and the stakes are the owner's call. What the design does instead is
> make honesty cheap to afford: history is never destroyed, a reset is displayed as a fact
> rather than a verdict, and the reason is captured as data. **The rules are not softened
> on the agent's initiative.**

---

## 6. The debrief

The circle's current debrief is two prose paragraphs. Prose is exactly why the
intelligence never materialises: thirty days times twelve men is roughly seven hundred
reports that no one can query. The thinking is kept; the blank page is not. See ADR-001.

### 6.1 Top G Insight — identify a clear victory

> Weak: *"Had a good workout."* — a feeling. No intelligence.
> Strong: *"Laying out gym clothes the night before eliminated the friction and I was out
> the door before the Bottom G could negotiate."* — a system, a victory, a replicable cause.

| Field | Type | Cap |
|---|---|---|
| `system_used` | text | 140 |
| `victory` | text | 140 |
| `protocol_id` | fk, nullable | which protocol it defended |

### 6.2 Bottom G Tactic — name the enemy's most effective manoeuvre

> Weak: *"I was weak and ate a cookie."* — self-blame, produces shame.
> Strong: *"Ambush at 15:00 using low energy as the trigger and 'you need a quick boost'
> as the propaganda."* — time, trigger, lie. Actionable.

Mostly enums, because this is the table that has to aggregate.

| Field | Type | Values |
|---|---|---|
| `occurred_at_hour` | int 0–23 | The single most valuable column in the schema |
| `trigger_kind` | enum | `low_energy`, `stress`, `boredom`, `loneliness`, `fatigue`, `celebration`, `social_pressure`, `frustration`, `other` |
| `propaganda` | text ≤140 | The exact lie, in his own words |
| `protocol_id` | fk, nullable | Which protocol was attacked |
| `outcome` | enum | `resisted`, `partial`, `lost` |

### 6.3 What this buys

Things a chat channel can never say:

- "Your enemy attacks between 14:00 and 16:00. 61% of your recorded tactics land there."
- "Low energy is his most successful weapon against you — you lose to it 7 times in 10.
  Against stress you hold 8 in 10."
- "'You deserve a reward' has appeared in your propaganda field nine times."
- "Every man in the circle fails the Digital Sunset more in week three than week one."

---

## 7. Visibility

What one member sees of another is his **report status**, his **commitments**, and whether
he was **hit**. Facts, not talk. There is no feed, no comments, no likes and no chat — the
circle has a group chat already, and a worse one inside this app would split the
conversation and turn accountability into performance.

Per-protocol visibility is configurable, and **sensitive protocols default to
`aggregate_only` for peers**: they count toward the day's status, which the circle sees,
but are not itemised to other members.

**The mentor sees full detail, itemised, and every member is told so at enrollment** —
before he files anything. Owner's decision, 2026-07-29; see ADR-009 for the alternatives
and what this one costs. The disclosure is what makes the access legitimate, so it is a
blocking step in the enrollment flow, not a line in a settings page.

---

## 8. The week

- The week runs **Monday to Sunday**. **[ASSUMED]** — implied by "declare Monday, settle
  Sunday" but never stated outright.
- Week boundaries are computed in each member's own timezone.
- A member declares **up to three** commitments for the week. Three is a cap enforced by a
  database constraint, not a suggestion.
- A commitment **cannot be edited once the week has started**. Declaring is committing —
  that is the entire mechanism.
- At week's end each commitment resolves `hit` or `missed`. A weekly review cannot be
  submitted with commitments still unresolved.
- A weekly review stores a **snapshot of its computed numbers**, so a man's past weeks do
  not silently change when the mentor edits the protocol list.

---

## 9. What the app deliberately does not do

Recorded here because these are decisions, not omissions, and each has an ADR.

| Not built | Why |
|---|---|
| Free-text journal | A blank textarea becomes a diary nobody rereads and a debt that makes men avoid the app after three missed days. Everything reflective is schema'd. **ADR-001** |
| Long checklists | They measure obedience, not progress. Protocols are few and heavy. |
| Gamification — XP, badges, levels, confetti | These are adults with mortgages. The rewards are self-respect and money. |
| Social feed, comments, likes, chat | They have a group chat. **§7** |
| AI-generated encouragement | Platitudes from a language model are worth nothing from a mentor who is right there. If a model is used at all it summarises a member's own numbers back to him. |
| Public signup | Invite-only, enforced in the database. **ADR-005** |

---

## 10. Corrections needed from the owner

### Settled — 2026-07-29

| Question | Answer |
|---|---|
| The SITREP deadline (§4) | **Local midnight.** No grace window. |
| Mentor visibility (§7) | **Full detail, disclosed at enrollment.** ADR-009. |
| The leading business actions (ADR-003) | **All six confirmed as proposed.** Seventh slot left open. |
| Protocol activation days (§2.0) | **Five waves: days 1, 4, 8, 15, 22.** |
| Zero-day threshold (§5.2) | **Three active protocols. Unchanged.** Confirmed 2026-07-30 with the day-one consequence understood: three protocols are live on day 1, so failing all of them is an act of treason rather than a tactical failure. Failing everything on the first day is a statement, and the doctrine answers it as one. |

### Still open, in priority order

1. **The week start** (§8). Monday assumed — implied by "declare Monday, settle Sunday"
   but never stated. Blocks Phase 5.
2. **Which protocols are `is_treason_trigger`** beyond the sexual-discipline oath. Seeded as
   the oath alone.
3. **The Fortress Protocol** (§2.4). Written per man — implemented that way, as
   `profiles.fortress_protocol`. Confirm there is no shared standard it should default to.
