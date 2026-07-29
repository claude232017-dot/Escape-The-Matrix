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
| Mentor access | A deliberate, stated choice the member sees **at enrollment**, never a silent default | Phase 2 — see §3 |
| Third-party analytics / error reporting / log aggregation | **Never** receives protocol detail. Scrubbed at the boundary, and the scrubbing is tested by asserting on the outgoing payloads | Phase 9 |
| Export | Includes everything the member owns, including the full war log | Phase 8 |
| Deletion | Means deletion | Phase 8 |
| Transport | HTTPS only | Ships with Vercel |
| At rest | Postgres, encrypted at rest by Supabase | Ships with Supabase |

---

## 3. The question for the owner

**How much of a member's protocol detail should the mentor see?**

The three coherent answers:

| Option | What the mentor sees | Cost |
|---|---|---|
| **A. Same as peers** | Day status and aggregate compliance. Sexual-discipline and substance protocols never itemised to anyone. | The mentor cannot spot the specific pattern he is best placed to help with. |
| **B. Full detail, disclosed** | Everything, itemised — and the member is told this **at enrollment**, in plain words, before he files anything. | Some men will under-report the sensitive protocols. That is a real cost to data quality, and it is honest. |
| **C. Member chooses per protocol** | Whatever each man opts into, defaulting to aggregate. | Uneven data across the circle; the Commander's View has to handle gaps without making the gap itself look like a confession. |

The agent's recommendation is **B, and only B done properly** — because it matches how the
circle already works (these men talk to this mentor about this material), and because a
silent version of B is the only genuinely wrong answer. The disclosure is what makes it
legitimate, not the access level.

What must not happen is the mentor quietly having full detail while members assume the
peer view applies to him too.

**Owner: answer this before Phase 2 implements the visibility model.**

---

## 4. RLS matrix

Filled in per phase. Every cell gets a test. Phase 9 requires a passing test per cell.

| Table | Role | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `app_meta` | `anon` | ✗ | ✗ | ✗ | ✗ |
| `app_meta` | `authenticated` | ✓ all | ✗ | ✗ | ✗ |
| `app_meta` | `mentor` | ✓ all | ✗ | ✗ | ✗ |

*Rows for `profiles`, `invitations`, `circles` land with Phase 1; the Forge tables with
Phase 2.*

Legend: ✓ own — own rows only. ✓ circle — rows in the member's circle. ✓ all —
unrestricted. ✗ — no policy, therefore denied.

---

## 5. Known gaps at Phase 0

Stated rather than implied, because a gap nobody wrote down becomes a gap nobody fixes.

- **No auth yet.** Phase 1. There is no login, no session, and no user data.
- **No rate limiting on auth.** Phase 9.
- **No error boundaries.** Phase 9.
- **No dependency audit in CI.** Phase 9. `npm audit` currently reports 0 vulnerabilities
  across 267 packages, checked manually at the Phase 0 gate.
- **The RLS matrix has one row** because there is one table.
