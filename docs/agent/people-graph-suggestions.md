---
type: codemap
title: People Graph Connection Suggestions
description: Postgres-only engine powering suggest_connections — projection, consent gate, and scoring.
resource: apps/web/src/lib/people-graph/suggestions.ts
tags: [ai, people-graph, connection-suggestions]
timestamp: 2026-07-01T00:00:00Z
---

# People Graph Connection Suggestions

## Overview

`suggest_connections` recommends member, alumni, and parent outreach targets for an organization. The people graph is served entirely from Postgres — `members`, `alumni`, `parents`, and `mentorship_pairs` — with no separate graph store. This replaced an earlier FalkorDB-backed design; the graph sync pipeline, cron, and `FALKOR_*` config were retired and the Postgres path became the permanent architecture.

Relevant code (all under `src/lib/people-graph/`):

- `people.ts`: `ProjectedPerson` model and `buildProjectedPeople()` / `buildSourcePerson()`
- `suggestions.ts`: `suggestConnections()` — the read path and entry point
- `scoring.ts`: candidate signal inspection, reason weighting, rarity multipliers, response shape
- `telemetry.ts`: in-memory per-org observability snapshot (not yet exposed via an API route)
- `name-matching.ts`: fuzzy person-query resolution

## How it works

### Step 1 — Data model (`people.ts`)

Members, alumni, and parents from Supabase are merged into `ProjectedPerson` objects. If rows share a `user_id`, they merge under `user:<userId>`. Unlinked rows stay separate as `member:<id>` / `alumni:<id>` / `parent:<id>`. Career signals are normalized before scoring: alumni `industry` values canonicalize into shared buckets, member `current_company` strings are parsed into employer + industry, and titles/role fragments map into a small `roleFamily` taxonomy.

### Step 2 — Consent gate (`isConnectionEdgeAllowed` in `suggestions.ts`)

A person only surfaces as a candidate when `openToNetworking` is true. Members and alumni are backfilled opt-in; parents stay opt-in and are additionally filtered at the query level. Source-side rules: a parent source must have opted in, and alumni-to-alumni suggestions require the source alumnus to also be opted in (reciprocity).

### Step 3 — Source resolution (`suggestions.ts`)

`suggestConnections()` resolves the source person either from `person_query` (name/email, with a small deterministic fuzzy matcher for near-misses) or from `person_type` + `person_id`. It then loads every row sharing that person's `user_id` across tables so a linked person always projects to one merged identity, regardless of which table the source came from.

### Step 4 — Scoring (`scoring.ts`)

Weighted reason codes, each boosted by an org-local rarity multiplier (rarer shared values score higher):

| Reason | Base weight |
|--------|-------------|
| `shared_industry` | 24 |
| `shared_company` | 20 |
| `shared_role_family` | 20 |
| `shared_city` | 4 |
| `graduation_proximity` | 3 |

Candidate generation (`buildCandidatePool`) prioritizes professional-strength signals (industry/company/role-family) and only falls back to city/graduation-year matches when the professional pool is small. `scoreProjectedCandidates` applies an in-memory rolling exposure penalty so candidates who keep appearing in recent top-3 lists get dampened. Deterministic tie-breaking: score → reason count → name → `person_id`.

### Step 5 — Response contract

`SuggestConnectionsResult` (`scoring.ts`) is the AI tool's response shape:

- `mode`: always `"sql_fallback"` — kept as a discriminator for API stability, not because another mode currently exists
- `fallback_reason`: always `null` for the same reason
- `freshness`: always `{ state: "fresh", as_of: <now> }` since Postgres reads are live
- `state`: `resolved`, `ambiguous`, `not_found`, or `no_suggestions`
- `source_person` / `suggestions[]`: display-ready people with `subtitle`, `score`, `reasons[]`

## Testing

```bash
node --import ./tests/register-ts-loader.mjs --test tests/people-graph.test.ts
node --import ./tests/register-ts-loader.mjs --test tests/people-graph-open-to-networking.test.ts
node --import ./tests/register-ts-loader.mjs --test tests/routes/ai/tool-executor.test.ts
```

`people-graph.test.ts` covers projection/dedup/scoring; `people-graph-open-to-networking.test.ts` covers the consent gate; `tool-executor.test.ts` exercises the AI tool executor entry point for `suggest_connections`.
