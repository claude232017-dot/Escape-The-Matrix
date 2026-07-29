# ADR-008 — TypeScript pinned to `~6.0`

**Status:** Accepted — revisit when `typescript-eslint` supports TypeScript 7
**Date:** 2026-07-29
**Phase:** 0

## Context

TypeScript 7 is released. `typescript-eslint@8.65` declares a peer range of
`>=4.8.4 <6.1.0`, so installing both fails resolution outright.

## Decision

Pin `typescript@~6.0`. Keep `typescript-eslint` on its current major.

## Options considered

| Option | Cost |
|---|---|
| `--legacy-peer-deps` with TS 7 | Installs a combination the linter's authors have not tested. Type-aware lint rules read the compiler's AST directly, so a major-version mismatch produces wrong results rather than a clean failure — and wrong lint results are worse than none, because they are believed. |
| Drop `typescript-eslint`, keep TS 7 | Loses every type-aware rule, including the `no-restricted-syntax` and `no-restricted-globals` guards that enforce ADR-004 and ADR-005. Those guards are load-bearing. |
| Pin TypeScript to 6.0 — **chosen** | Forgoes TS 7 features for a few months. Nothing in this codebase needs them. |

## Related friction

TypeScript 6 deprecates `baseUrl`. It was removed from both tsconfigs; `paths` without it
resolves relative to the config file, which is what was wanted anyway. This is worth knowing
because the deprecation surfaces as an *error*, not a warning, and reads like a
misconfiguration rather than a version issue.

## Revisit

When `typescript-eslint` ships TypeScript 7 support, bump both together and delete this ADR's
"Accepted" status. The pin is `~6.0` rather than an exact version so patches still flow.
