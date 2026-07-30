# Security

**Owner: read §2 and §3 and answer the question at the end of §3. It changes what gets
built in Phase 2, and it is not a decision the agent should make alone.**

---

## 1. The enforcement boundary

The `VITE_SUPABASE_ANON_KEY` is public. It ships in the JavaScript bundle and anyone with
the app can read it. That is by design — it is an identifier, not a secret.

Which means: **anything enforced only in the browser is decoration.** Every rule that
matters is a row-level security policy or a database constraint. Client-side checks exist
solely to give a fast, clear error before a round trip.

Where a rule is duplicated between TypeScript and SQL, the comment in each file names the
other. Current pairs:

| Rule | TypeScript | SQL |
|---|---|---|
| 140-character cap on structured prose | feature validation modules | `app.capped_text_140` |
| Supported currencies | `CURRENCY_EXPONENTS`, `src/lib/money.ts` | `app.currency_code` + per-table CHECK |
| One SITREP per member per local date | `src/lib/date.ts` | unique index on `(enrollment_id, local_date)` |
| A MED option may only accompany a MED pass | `setStatus()`, `src/features/forge/sitrep-draft.ts` | `protocol_results_med_option_only_for_med_pass` |
| An insight needs both its halves | `insightState()`, `src/features/forge/debrief-draft.ts` | `debriefs_insight_paired` |
| An attack has an outcome; a quiet day does not | `blockers()`, `src/features/forge/debrief-draft.ts` | `debriefs_outcome_iff_attacked` |
| The hour an attack landed, in his own timezone | `localHour()`, `src/features/forge/debrief-draft.ts` | `bottom_g_tactics.occurred_at_hour`, stored as a plain 0–23 integer |
| What today's date is, for a member | `getLocalDateString()`, `src/lib/date.ts` | `app.today_for()`, and inlined once in `public.start_campaign_enrollment()` |
| What a day amounts to (complete / repeat / reset) | `evaluateDay()`, `src/features/forge/doctrine.ts` | not enforced in SQL — see below |

The last row is the one honest exception, and it is worth naming rather than leaving to be
discovered. The database does **not** recompute whether a day was a reset; it accepts the
`final_status` the client sends. What it does enforce is everything a wrong answer could be used
to *gain*: which dates may be filed against, that a day cannot be filed before it is lived, that
an enrollment cannot be back-dated, and that a reset cannot be quietly taken back. A man who
lies to this app about his own day has defeated a thing that only works if he does not, and no
constraint can fix that. A man who forges a *date* is attacking the dataset, and that is closed.

**Never** put a service-role key in a `VITE_`-prefixed variable. That prefix means "bundle
this into the file served to the browser", and a service-role key bypasses every policy on
this page.

### How this is verified

`tests/db/rls-posture.test.ts` applies the real migrations to a real Postgres and queries
the catalogue. It asserts, on every table in `public`:

- RLS is **enabled**;
- RLS is **forced**, so the owning role is not exempt from its own policies;
- the table has at least one policy (RLS with no policy is not "secure by accident" — it
  is an unreadable table that surfaces later as an empty screen nobody can explain);
- no `USING (true)` that is not registered as deliberate, with a reason;
- no unconditional write policy — a permissive read can be a judgement call, a permissive
  write never is;
- no grant of any kind to `anon`.

Verified by mutation: adding a table without RLS, a policy with `USING (true)`, and an
`anon` grant makes four of those assertions fail, each naming the specific defect.

"I reviewed the policies" is not verification. A `USING (true)` left over from debugging
looks exactly like a correct policy in a diff.

---

## 2. This data is genuinely sensitive

The app records, **per identified individual**:

| Data | Sensitivity |
|---|---|
| Compliance with a sexual-discipline protocol | **GDPR Article 9 special category** — data concerning a person's sex life |
| Substance use — alcohol, recreational drugs | Health-adjacent; special category in some readings |
| Psychological failure patterns — triggers, propaganda, the hours he is weakest | Not special category, but a detailed profile of a named person's vulnerabilities |
| Income and revenue | Financial |

This is a small private circle, so the population is tiny — which cuts both ways. The
breach surface is small; the harm from a breach is concentrated and personal, and every
row is attributable to a specific named man who knows the others.

### Handling table

| Concern | Rule | Status |
|---|---|---|
| Per-protocol visibility | Configurable per protocol (`protocols.visibility`) | Phase 2 |
| Sensitive protocols | Default to **`aggregate_only`** — they count toward the day's status, which the circle sees, but are **not itemised to peers** | Phase 2 |
| Psychological failure patterns | `bottom_g_tactics` — the hour a man is weakest, the trigger that beats him, and the lie he tells himself. **Self and mentor only; peers get zero rows.** | Phase 3 |
| Mentor access | A deliberate, stated choice the member sees **at enrollment**, never a silent default | Phase 2 — see §3 |
| Third-party analytics / error reporting / log aggregation | **Never** receives protocol detail. Scrubbed at the boundary, and the scrubbing is tested by asserting on the outgoing payloads | Phase 9 |
| Export | Includes everything the member owns, including the full war log | Phase 8 |
| Deletion | Means deletion | Phase 8 |
| Transport | HTTPS only | Ships with Vercel |
| At rest | Postgres, encrypted at rest by Supabase | Ships with Supabase |

---

## 3. Mentor visibility — decided

**Option B: full detail, disclosed at enrollment.** Owner's decision, 2026-07-29. See
ADR-009 for the alternatives and their costs.

The mentor sees every protocol itemised, including the sexual-discipline and substance
protocols. Peers do not — those default to `aggregate_only` and count only toward the
day's status.

**The disclosure is what makes this legitimate, not the access level**, so it is a
build requirement rather than a policy note:

| Requirement | Where |
|---|---|
| Enrollment shows, in plain words, exactly what the mentor will see — before the member files anything | Phase 1, blocking step in the enrollment flow |
| Acceptance is recorded with a timestamp and the doctrine version in force | Phase 1, `enrollments.disclosure_accepted_at` + `disclosure_version` |
| A member can re-read the disclosure at any time without hunting for it | Phase 1, linked from his profile |
| Re-consent when the disclosure text materially changes | Phase 2, on doctrine version bump |
| The mentor's read access is enforced by RLS, not by hiding UI | Phase 2 |

The failure mode this is built to prevent: **the mentor quietly having full detail while
members assume the peer view applies to him too.** That is the one genuinely wrong version
of this decision, and every requirement above exists to make it impossible to ship by
accident.

### The cost, stated plainly

Some men will under-report the sensitive protocols once they know the mentor sees them
itemised. That is a real hit to data quality and it was accepted knowingly. Watch for it:
a member whose sexual-discipline protocol is passed every single day from Day 1 while his
other protocols show normal variance is more likely under-reporting than perfect.

Do **not** build a detector for that. It would be a machine accusing a man of lying to his
mentor, which destroys the trust the disclosure just bought. It is a thing for the mentor
to notice and raise in person.

---

## 4. RLS matrix

Filled in per phase. Every cell gets a test. Phase 9 requires a passing test per cell.

| Table | Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `app_meta` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `app_meta` | `authenticated` | ✓ all | ✗ | ✗ | ✗ |
| `circles` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `circles` | member | ✓ own circle | ✗ | ✗ | ✗ |
| `circles` | mentor | ✓ own circle | ✗ | ✗ | ✗ |
| `profiles` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `profiles` | member | ✓ circle | ✗ | ✓ own, **7 columns only** | ✗ |
| `profiles` | mentor | ✓ circle | ✗ | ✓ own, **7 columns only** | ✗ |
| `invitations` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `invitations` | member | ✗ | ✗ | ✗ | ✗ |
| `invitations` | mentor | ✓ own circle | ✓ own circle | ✓ own circle | ✓ own circle |
| `campaigns` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `campaigns` | member | ✓ own circle | ✗ | ✗ | ✗ |
| `campaigns` | mentor | ✓ own circle | ✓ own circle | ✓ own circle | ✗ |
| `protocols` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `protocols` | member | ✓ own circle | ✗ | ✗ | ✗ |
| `protocols` | mentor | ✓ own circle | ✓ own circle | ✓ own circle | ✓ own circle |
| `protocol_med_options` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `protocol_med_options` | member | ✓ own circle | ✗ | ✗ | ✗ |
| `protocol_med_options` | mentor | ✓ own circle | ✓ own circle | ✓ own circle | ✓ own circle |
| `enrollments` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `enrollments` | member | ✓ circle | ✓ own | ✓ own | ✗ **no grant** |
| `enrollments` | mentor | ✓ circle | ✓ own | ✓ own | ✗ **no grant** |
| `sitreps` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `sitreps` | member | ✓ circle | ✓ own | ✓ own | ✗ **no grant** |
| `sitreps` | mentor | ✓ circle | ✓ own | ✓ own | ✗ **no grant** |
| `protocol_results` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `protocol_results` | member | ✓ own **+ peers' `itemised` only** | ✓ own | ✓ own | ✓ own |
| `protocol_results` | mentor | ✓ circle, **all protocols** | ✓ own | ✓ own | ✓ own |
| `reset_events` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `reset_events` | member | ✓ own only | ✓ own | ✗ | ✗ **no grant** |
| `reset_events` | mentor | ✓ own + circle | ✓ own | ✗ | ✗ **no grant** |
| `debriefs` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `debriefs` | member | ✓ circle | ✓ own | ✓ own | ✓ own |
| `debriefs` | mentor | ✓ circle | ✓ own | ✓ own | ✓ own |
| `bottom_g_tactics` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `bottom_g_tactics` | member | ✓ **own only** | ✓ own | ✓ own | ✓ own |
| `bottom_g_tactics` | mentor | ✓ own + circle | ✓ own | ✓ own | ✓ own |

Legend: ✓ own — own rows only. ✓ circle — rows in the member's circle. ✓ all —
unrestricted. ✗ — no policy or no grant, therefore denied.

Every cell above has a passing test: identity in `tests/db/identity-rls.test.ts`, the Forge in
`tests/db/forge-rls.test.ts`, all run as real `authenticated` sessions with real JWT claims.

The row that matters most is `protocol_results` for a **member**. A peer may read a result only
when the protocol is marked `itemised`; for `sexual-discipline` and `alcohol-and-drugs` he gets
**zero rows**. That is the §2 handling table enforced rather than described, and it is asserted
directly rather than inferred from the policy text.

The debrief's two tables are the same principle applied a second time, and the reason it is two
tables rather than one. The **Top G Insight** is a system that worked, so the circle reads it —
that is what a circle is for. The **Bottom G Tactic** is when a specific man is weakest, what
reliably beats him, and the exact lie he tells himself; a peer gets **zero rows**. DOCTRINE §7
draws the line at "whether he was hit", so `attacked` and `outcome` sit in the peer-readable table
and everything about *how* sits in the private one. A peer's query cannot return failure detail
because the columns are not in the table he can read — structural, not a policy someone can loosen
by accident.

`enrollments`, `sitreps` and `reset_events` have **no DELETE grant at all**. History is never
destroyed (ADR-002), and the absence of the privilege is what makes that structural rather than a
convention someone can forget. The debrief tables *do* have DELETE: a debrief is a man's own
reflection rather than a record of what he did, and "I was not attacked after all" has to be
expressible. The day itself is untouched either way.

### RPCs

Two functions in `public` are reachable over the API. Both are **SECURITY INVOKER**, so every
policy above still applies inside them — see ADR-012.

| Function | `anon` | `authenticated` |
|---|---|---|
| `public.file_sitrep(...)` | ✗ revoked | ✓ own enrollment only |
| `public.start_campaign_enrollment(uuid)` | ✗ revoked | ✓ own profile only |
| `public.file_debrief(...)` | ✗ revoked | ✓ own day only |

Functions in `public` are EXECUTE-to-PUBLIC by default, and the default privileges revoked in
`0001_baseline.sql` do **not** remove that grant — so a new function is exposed to `anon` unless a
migration explicitly revokes it. `tests/db/rls-posture.test.ts` enumerates every function in
`public` reachable by either role and compares it against an allowlist, so the next RPC cannot be
added without someone deciding it is API surface.

### Two enforcement details worth knowing

**`profiles` UPDATE is limited by a column-level grant, not by a policy.** `role` and
`circle_id` are simply not in the `GRANT UPDATE (...)` list, so an attempt to change them
is rejected by the privilege system before any policy runs. This is deliberate: `WITH
CHECK` cannot see `OLD`, so it cannot express "role must not change" — a policy that
appeared to prevent privilege escalation but did not would be worse than an honest grant.
The seven grantable columns are `display_name`, `timezone`, `top_g_code`,
`command_post_note`, `fortress_protocol`, `disclosure_accepted_at`, `disclosure_version`.

**`profiles` and `invitations` do not have `FORCE` RLS, on purpose.** `FORCE` makes the
table *owner* subject to the table's policies, and the owner is who `SECURITY DEFINER`
functions run as. The signup triggers must read `invitations` and insert into `profiles`
before any session exists — where `auth.uid()` is null — so under `FORCE` every signup
would be rejected. `FORCE` is not load-bearing here: application traffic arrives as
`anon` or `authenticated` and never as the owner. The exemption is a list with reasons in
`tests/db/rls-posture.test.ts`, asserted to be neither stale nor silently widened.

---

## 5. Known gaps at Phase 0

Stated rather than implied, because a gap nobody wrote down becomes a gap nobody fixes.

- **No auth yet.** Phase 1. There is no login, no session, and no user data.
- **No rate limiting on auth.** Phase 9.
- **No error boundaries.** Phase 9.
- **No dependency audit in CI.** Phase 9. `npm audit` currently reports 0 vulnerabilities
  across 267 packages, checked manually at the Phase 0 gate.
- **The RLS matrix has one row** because there is one table.
