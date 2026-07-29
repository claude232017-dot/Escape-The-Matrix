# ADR-007 — The palette lives in TypeScript; the stylesheet is generated

**Status:** Accepted
**Date:** 2026-07-29
**Phase:** 0

## Context

The requirement is that a **measured** contrast test over the token palette exists, so a
future colour tweak cannot quietly fail 4.5:1. A test can only measure colours it can read,
and colours in a `.css` file are not readable by a Vitest suite without parsing CSS.

## Decision

`src/design/tokens.ts` is the single source. `src/styles/tokens.css` is **generated** from
it by `npm run tokens:build`, and a test fails if the committed CSS has drifted from what
the source would produce.

Contrast is checked against an explicit list of `CONTRAST_PAIRS` — every foreground/background
combination the UI is permitted to produce — and **a colour token with no declared usage
fails the suite**.

## Options considered

### A. Colours in CSS, contrast checked by eye — rejected

The default. **Cost:** it is the thing the requirement exists to prevent.

### B. Colours in CSS, parsed by the test — rejected

**Cost:** the test then depends on a CSS parser and on the file's formatting, and it can
only check the values it manages to extract. A colour written as `rgb()`, or set inside a
media query, silently escapes.

### C. Cross-product of all tokens — rejected

Measure every token against every other token.

**Cost:** most pairs are meaningless. `surface-base` on `surface-raised` fails 4.5:1 and
always will, because they are both surfaces and nothing puts text in one on the other. A
suite full of expected failures gets exemptions added until the exemption list *is* the
design, and at that point it measures nothing. The failures would also say nothing about
where the problem is.

### D. Generated CSS plus declared pairs — chosen

**Cost, honestly:** the pair list is maintained by hand, and a developer can put a colour
combination on screen without declaring it here. That is the real hole in this design.

Two things narrow it. Every *token* must appear in at least one pair, so a new colour cannot
be introduced silently — only a new *combination* of existing colours can slip through. And
a browser test reads the computed custom properties back out of the running page and
compares them to the same constants the contrast suite measured, so the measured palette and
the shipped palette cannot diverge.

Closing it completely would need runtime contrast checking of rendered elements. That is a
Phase 9 candidate, not a Phase 0 one.

## The `decorative` classification

`border-subtle` is a section rule, not a control boundary, and WCAG 1.4.11 does not require
3:1 of it. It is classified `decorative` with a 1.5:1 floor — a guard against invisibility
rather than a legibility standard.

This is an obvious escape hatch, so it is closed: `DECORATIVE_ONLY_TOKENS` lists the tokens
permitted to carry that classification, and a test asserts no other token uses it **and**
that a decorative token never appears in a `text` or `non-text` pair. Without that, any pair
failing 3:1 could be relabelled until it passed.

When `border-subtle` measured 1.33:1 against `surface-raised` during Phase 0, the fix was to
lighten the colour to `#2E3D52`, not to lower the threshold.
