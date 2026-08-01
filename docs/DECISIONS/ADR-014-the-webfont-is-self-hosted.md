# ADR-014 — The webfont is self-hosted, or there is no webfont

**Status:** Accepted
**Date:** 2026-08-01
**Phase:** 9 (design pass)

## Context

`SCALE_TOKENS['font-sans']` named `'Inter'` from Phase 0 onward. Nothing ever delivered it:
no `@font-face`, no `<link>`, no dependency. Every screen rendered in whatever
`ui-sans-serif` resolves to — a different face on macOS, Windows and Android — while the
token file asserted otherwise.

Two things had to be settled at once: whether to ship the font at all, and if so, from where.
The second question is not a performance question. §3.5 forbids sending anything about a
member to a third party, and the usual way to load a webfont sends more than people expect.

## Decision

**The font ships from this origin, or the stack does not name it.**

`src/styles/fonts.css` declares one `@font-face` against the latin variable subset of Inter,
vendored through `@fontsource-variable/inter` and emitted into the build as a single hashed
48 kB `woff2`. `font-sans` names `'Inter Variable'`, which is the family that file declares.

`font-display: optional`, not `swap`.

`src/design/tokens.test.ts` enforces all three properties: every quoted, non-system family in
a stack must have a matching `@font-face`; no `@font-face` `src` may be an absolute URL; and
`font-display` may not be `block` or `auto`.

## Options considered

### A. Google Fonts, two lines in `index.html` — rejected

The default, and the reason this ADR exists.

A `fonts.gstatic.com` request carries the member's **IP address** and a `Referer` naming this
application, on every cold load, for every man in the circle. We construct an error payload
from scratch at the egress boundary specifically so nothing a member typed can leak to a third
party — and then hand a different third party the fact of the visit, the approximate location
and the app's identity, for free.

**Cost:** it is the same disclosure §3.5 exists to prevent, arranged through a stylesheet
instead of a reporter SDK. That the payload is a font rather than a stack trace does not change
who learns that this man opened this app this morning.

### B. Leave the stack naming a font nobody ships — rejected

Zero bytes and honest-looking. **Cost:** it is not honest. The token file is the design
contract and the contrast suite is measured against it; a stack that names a font which never
arrives means the palette was measured against letterforms nobody has ever seen, and the
comment claiming otherwise cannot be falsified by any test.

If the answer were "no webfont", the correct form of that answer is deleting `'Inter'` from
the stack — not leaving it there looking implemented.

### C. Self-hosted, `font-display: swap` — rejected

The common recommendation. **Cost:** `swap` paints the fallback and then reflows the entire
page when the font lands, which is a jolt at exactly the moment somebody is reading. This is a
tool a man opens every morning for thirty days: the font is cached from the second visit
onward, so `optional` costs one plain-looking first paint and buys **zero layout shift** for
the remaining twenty-nine.

### D. Self-hosted, importing the package's own stylesheet — rejected

One line instead of a hand-written `@font-face`. **Cost:** it pulls in cyrillic, greek and
vietnamese subsets. `unicode-range` means a browser never *fetches* them, but the build still
emits eight `woff2` files, and a `dist` carrying seven assets nothing can request is a build
that is not honest about what it ships.

## Consequences

- One extra request on a cold load, 48 kB, from this origin, never blocking first paint.
- A first-time visitor on a slow link may see the system face for that session. Accepted:
  see option C.
- The variable `wght` axis covers 100–900, so the whole type scale is one file rather than one
  per weight.
- Adding a second branded family now requires shipping it. The test will not accept a name
  with nothing behind it, which is the failure this ADR was written after finding.
