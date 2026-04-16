# Falkor People Graph

## Overview

The Falkor people graph powers the AI tool `suggest_connections`, which recommends member and alumni outreach targets for an organization. The graph is org-scoped, built from `members`, `alumni`, and `mentorship_pairs`. Falkor and SQL fallback share the same scoring (see **Step 6** and **Step 7**).

Flow diagram (chat → `suggest_connections` → Falkor or SQL → pass 2): [falkor-connection-suggestions.md](falkor-connection-suggestions.md).

Relevant code:

- `src/lib/falkordb/client.ts`: Falkor connection and config
- `src/lib/falkordb/people.ts`: projection model and person-key rules
- `src/lib/falkordb/suggestions.ts`: `suggest_connections` read path
- `src/lib/falkordb/sync.ts`: graph sync worker
- `src/app/api/cron/graph-sync-process/route.ts`: queue drain route
- `supabase/migrations/20260715000000_falkor_people_graph_foundation.sql`: queue, triggers, RPCs
- `supabase/migrations/20260715000001_graph_sync_queue_org_freshness_index.sql`: freshness query index

## How it works (end-to-end)

### Step 1 — Data model (`people.ts`)

Members and alumni from Supabase are merged into `ProjectedPerson` objects. The identity model is the foundation: if a member and alumni share a `user_id`, they merge under `user:<userId>`. Unlinked rows stay separate as `member:<id>` or `alumni:<id>`. Both write and read paths use `buildProjectedPeople()`.

Connection reads also normalize career signals before scoring:
- alumni `industry` values are canonicalized into shared buckets such as `Technology`, `Finance`, and `Healthcare`
- member `current_company` strings like `Microsoft (SWE intern)` or `Penn Medicine — clinical research assistant` are parsed into employer names and, when recognized, mapped to a canonical industry
- alumni titles and member role fragments are normalized into a small shared `roleFamily` taxonomy used for candidate generation and ranking
- alumni still win when linked alumni data is richer than member data

### Step 2 — Infrastructure (`client.ts`)

`FalkorClientImpl` manages the connection. Config resolves from env vars in priority order: `FALKOR_URL` (remote) → `FALKOR_HOST` (remote discrete) → `FALKOR_EMBEDDED` (local dev with falkordblite). Each org gets its own graph named `teamnetwork_people_<orgId>`. The `FalkorQueryClient` interface is the DI seam — tests inject stubs here.

### Step 3 — Database foundation (migration SQL)

Triggers on `members`, `alumni`, and `mentorship_pairs` fire on INSERT/UPDATE, compare relevant fields, and enqueue changed rows to `graph_sync_queue` with old-key context in the payload. Four service-role RPCs: `dequeue_graph_sync_queue` (SKIP LOCKED for concurrency), `increment_graph_sync_attempts`, `purge_graph_sync_queue`, and `backfill_graph_sync_queue`.

### Step 4 — Write path (`sync.ts`)

Queue items are processed per `source_table`. For people: re-read all active source rows for the identity key, rebuild the projection, upsert or delete the `Person` node, then reconcile adjacent `MENTORS` edges. For mentorship pairs: reconcile both old and current endpoints. The worker is reconciliatory — it never trusts the queue payload as source of truth; it always re-reads current DB state.

### Step 5 — Cron endpoint (`route.ts`)

`GET /api/cron/graph-sync-process` loops `processGraphSyncQueue` for up to 25 seconds, then purges rows older than 7 days. Auth via `CRON_SECRET` bearer token.

### Step 6 — Scoring (`scoring.ts`)

Five normalized reason codes exist, but only four are required to qualify a candidate for final rendering. Falkor and SQL paths use identical scoring:

| Reason | Weight |
|--------|--------|
| `shared_industry` | 24 × rarity |
| `shared_company` | 20 × rarity |
| `shared_role_family` | 20 × rarity |
| `shared_city` | 4 |
| `graduation_proximity` | 3 |

Candidate generation and reranking are split:
- candidate generation starts from professional signals (`shared_industry`, `shared_company`, `shared_role_family`, or adjacent `roleFamily`) and only uses city/year to expand the pool when the professional pool is small
- final rendered suggestions must include at least one professional-strength exact match, so city + graduation proximity alone now degrade to `no_suggestions`
- rarity is computed from the org-local projected people set using bounded multipliers, so common industries/companies/role families count less than rarer ones
- an in-memory rolling exposure penalty dampens candidates who keep appearing in recent top-3 lists

`graduation_proximity` matches when the source and candidate graduated within 3 years of each other. `shared_company` is suppressed when the normalized company value is the platform name (`TeamNetwork`) or the current organization's name, so generic org-internal company strings do not flatten rankings across the whole org. Deterministic tie-breaking stays: score → reason count → name → `person_id`.

### Step 7 — Read path (`suggestions.ts`)

`suggestConnections()` is the main entry. It resolves the source person with cross-table complement (loads both member and alumni rows for the same user), builds org-local rarity/exposure context, then branches:

- **Falkor mode:** query all candidate `Person` nodes in the org, dedupe to canonical people, build the gated candidate pool, then rerank in app code.
- **SQL fallback:** load the full org projection from Supabase and run the same gated candidate generation + reranking path.

If Falkor throws, the implementation silently falls back to SQL.

Same flow as diagram in [falkor-connection-suggestions.md](falkor-connection-suggestions.md).

### Step 8 — Testing

Tests verify graph/SQL parity, projection deduplication, merged source attributes, and sync worker integration. `scripts/test-falkor-local.ts` runs a full in-process cycle: backfill → sync → query → suggest.

### Current state

**What is built and working**

- Full write path: triggers → queue → sync worker → Falkor graph
- Full read path: dual-mode suggestions with automatic fallback
- Graph model: `Person` nodes + directed `MENTORS` edges
- Scoring parity between Falkor and SQL paths
- Embedded mode for local dev, remote mode for production
- Test coverage for projection, scoring, parity, and sync integration

**Typical in-flight work** (adjust as branches land; paths from recent `codex/falkor-people-graph` work)

- `src/lib/falkordb/people.ts` and `suggestions.ts`
- `docs/agent/falkor-people-graph.md` and related docs
- `tests/falkordb-people-graph.test.ts`
- New or touched scripts/tests: `scripts/test-falkor-local.ts`, `tests/create-org-checkout-integration.test.ts`

The graph stores only `Person` nodes and `MENTORS` edges today. There are no event or interaction edges, no group-membership edges, and no weighted graph affinity. Ranking is career-signal-oriented in app code: shared industry and shared company dominate, with city and graduation proximity as supporting signals. Expanding the graph model (e.g. shared event attendance, chat interactions, discussion co-participation) is a natural next step if richer recommendations are needed.

### Revisit notes from the March 25, 2026 latency pass

- The AI chat latency work intentionally made narrow structured org questions feel fast by skipping RAG for tool-only turns. Local verification showed member, parent, and event queries succeeding quickly on that path.
- `suggest_connections` was not a good latency baseline during that pass. The graph data was still sparse for high-confidence connection recommendations, and local testing also exposed an import regression: `src/lib/falkordb/suggestions.ts` still imports `normalizeConnectionText`, but `src/lib/falkordb/scoring.ts` no longer exports it.
- When revisiting Falkor work, first restore that import/export compatibility and rerun direct-name connection prompts before drawing conclusions about graph quality.
- After the import issue is fixed, evaluate connection quality with richer org data. If recommendations are still weak, prefer improving graph population and signal coverage before tuning ranking weights.

## Graph Model

Node/edge shape matches **Current state** above. This section lists persisted properties and edge semantics.

### `Person` node properties

The sync worker writes a compact projection of a person into Falkor:

- `orgId`
- `personKey`
- `personType`
- `personId`
- `name`
- optional `memberId`
- optional `alumniId`
- optional `userId`
- optional `role`
- optional `major`
- optional `currentCompany`
- optional `industry`
- optional `graduationYear`
- optional `currentCity`

### Identity model

`personKey` on each node follows the rules in **Step 1 — Data model** (`user:…`, `member:…`, `alumni:…`).

### Mentorship edges

`mentorship_pairs` become directed `(:Person)-[:MENTORS]->(:Person)` edges using mentor and mentee `user_id` values. If a pair is deleted or becomes inactive, the edge is removed on the next sync pass.

## How Sync Works

End-to-end behavior is **Steps 3–5** (triggers/RPCs, `sync.ts` worker, cron route). Extra detail worth keeping here:

- Each queue row includes `org_id`, `source_table`, `source_id`, `action`, and `payload`. The payload carries old keys (e.g. prior `user_id`, `organization_id`, mentorship endpoints) so the worker can reconcile old and new graph identities.
- Cron auth: `Authorization: Bearer $CRON_SECRET`. If `CRON_SECRET` is missing, the route returns 500 and sync does not run.

## Setup

### 1. Run the Supabase migrations

The Falkor feature depends on the queue table, trigger functions, dequeue RPCs, backfill RPC, and mentorship-distance RPC from:

- `supabase/migrations/20260715000000_falkor_people_graph_foundation.sql`
- `supabase/migrations/20260715000001_graph_sync_queue_org_freshness_index.sql`

### 2. Configure Falkor

Falkor is disabled unless:

```text
FALKOR_ENABLED=true
```

Then choose one of these modes.

#### Remote Falkor

Either provide:

```text
FALKOR_URL=redis://username:password@host:port
```

Or provide discrete vars:

```text
FALKOR_HOST=...
FALKOR_PORT=6379
FALKOR_USERNAME=...
FALKOR_PASSWORD=...
```

Optional:

```text
FALKOR_GRAPH_PREFIX=teamnetwork_people
```

Each org gets its own graph named:

```text
<graph_prefix>_<org_id_with_non_alnum_replaced_by_underscores>
```

#### Embedded Falkor

For local development you can run embedded mode:

```text
FALKOR_ENABLED=true
FALKOR_EMBEDDED=true
```

Optional:

```text
FALKOR_EMBEDDED_PATH=...
FALKOR_REDIS_SERVER_PATH=...
FALKOR_GRAPH_PREFIX=teamnetwork_people
```

If `FALKOR_REDIS_SERVER_PATH` is not set, the app looks for:

- `/opt/homebrew/bin/redis-server`
- `/usr/local/bin/redis-server`

### 3. Configure the cron secret

```text
CRON_SECRET=some-shared-secret
```

This is required for `/api/cron/graph-sync-process`.

### 4. Backfill an organization

New writes enqueue automatically, but an existing org needs an initial backfill. Run:

```sql
select public.backfill_graph_sync_queue('<org-id>');
```

That enqueues all active:

- members
- alumni
- mentorship pairs

for the org.

### 5. Drain the queue

Call the cron route until the queue is empty:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/graph-sync-process
```

The response includes:

- `processed`
- `skipped`
- `failed`
- `iterations`
- `purgedQueueRows`
- `durationMs`

## Read Path and Freshness

`suggest_connections` is implemented in `src/lib/falkordb/suggestions.ts`.

### Source person resolution

Before querying Falkor, the app resolves the source person on the server:

- chat-driven prompts may pass `person_query` (name or email) directly to `suggest_connections`
- direct email and full-name matches still resolve immediately
- if no exact name/email match exists, the resolver now applies a small deterministic in-memory name matcher over the org's projected people
- v1 fuzzy support is intentionally narrow: Matt-family aliases (`mat`, `matt`, `matthew`) plus two-token first/last prefix shorthand such as `mat leo`
- fuzzy matches only auto-resolve when one candidate clearly beats the runner-up; otherwise the tool returns `ambiguous`
- internal callers may still pass `person_type` plus `person_id`
- once a concrete source is identified, the app builds a merged source projection using the same rules as the full SQL projection
- if the source has a `user_id`, it loads all matching complement rows from the other table
- it then builds a single merged source person

This matters because scoring reasons like shared company or graduation proximity depend on the merged source attributes, not just the row the admin clicked on. It also means the AI route no longer depends on the model discovering a separate `list_members -> suggest_connections` tool chain for direct-name prompts.

### Freshness

The read path checks the oldest pending queue item for the org:

- if lag is low, freshness is `fresh`
- if lag exceeds `GRAPH_STALE_AFTER_SECONDS`, freshness is `stale`

The per-org freshness lookup is supported by:

- `idx_graph_sync_queue_org_freshness`

### Fallback behavior

Same as **Step 7** (disabled/unavailable Falkor or thrown graph query → SQL, still ranked). This keeps the tool usable during setup, outages, or local dev without Falkor.

### Chat-ready payload

After ranking, both Falkor and SQL fallback normalize into the same chat-ready envelope:

- `state`: `resolved`, `ambiguous`, `not_found`, `no_suggestions`
- `source_person`: display-ready source identity
- `suggestions`: top suggestions in final display order with `subtitle`, `score`, preview fields, and normalized reason labels
- `disambiguation_options`: present only for ambiguous `person_query` matches
- `mode`, `freshness`, and `fallback_reason`

This is the integration boundary between the people graph and the AI route. Single-tool connection turns are rendered directly from this payload in the route, while mixed tool turns can still hand it to pass 2 with a fixed connection template. Grounding verifies the rendered answer against this normalized payload instead of against raw graph rows.

## How To Test It

### Fast automated checks

Run the focused tests:

```bash
node --test --loader ./tests/ts-loader.js tests/falkordb-people-graph.test.ts
node --test --loader ./tests/ts-loader.js tests/routes/ai/tool-executor.test.ts
```

The first file covers graph/fallback parity and source-projection edge cases. The second exercises the AI tool executor entry point for `suggest_connections`.

### Manual fallback test

1. Leave `FALKOR_ENABLED` unset or set it to `false`
2. Start the app with `npm run dev`
3. Use the org AI chat to ask for outreach suggestions

Expected result:

- the tool still works
- rankings come from SQL fallback

### Manual Falkor test

1. Enable Falkor with either remote or embedded mode
2. Backfill the org
3. Drain the queue through `/api/cron/graph-sync-process`
4. Ask the same chat question again

Expected result:

- the tool uses the graph path
- returned rankings and reasons match SQL parity for the same source data

### Teammate local runbook

For a one-command local verification, run:

```bash
npx tsx scripts/test-falkor-local.ts
```

Optional args:

```bash
npx tsx scripts/test-falkor-local.ts <org-id>
npx tsx scripts/test-falkor-local.ts <org-id> <personType:personId>
```

Examples:

```bash
npx tsx scripts/test-falkor-local.ts
npx tsx scripts/test-falkor-local.ts ce2e47f8-388a-4e06-9a2d-6d5b851ee899
npx tsx scripts/test-falkor-local.ts ce2e47f8-388a-4e06-9a2d-6d5b851ee899 member:7f217239-...
```

What the script does:

1. Loads `.env.local`
2. Backfills the org queue
3. Processes the queue in the same process
4. Verifies Falkor has `Person` nodes
5. Runs supported distance queries
6. Calls `suggestConnections`
7. Prints `mode`, `freshness`, and ranked results

This matters in embedded mode because the local Falkor process is ephemeral per process. The script keeps backfill, sync, and query verification inside one run.

### Falkor Browser verification

If you want to inspect the graph visually in Falkor Browser, these queries are safe to use.

#### Show all mentorship edges

```cypher
MATCH (a)-[r:MENTORS]->(b)
RETURN a, r, b
```

#### Count people and mentorship edges

Run these separately:

```cypher
MATCH (p:Person)
RETURN count(p) AS people
```

```cypher
MATCH ()-[r:MENTORS]->()
RETURN count(r) AS mentorship_edges
```

#### Show direct outgoing mentorships for one source

```cypher
MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(candidate:Person)
RETURN candidate.personKey AS personKey, candidate.name AS name
```

#### Show direct incoming mentorships for one source

```cypher
MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(candidate:Person)
RETURN candidate.personKey AS personKey, candidate.name AS name
```

#### Show second-degree mixed-direction paths

Shared mentor shape:

```cypher
MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)-[:MENTORS]->(candidate:Person)
RETURN candidate.personKey AS personKey, candidate.name AS name
```

Shared mentee shape:

```cypher
MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)<-[:MENTORS]-(candidate:Person)
RETURN candidate.personKey AS personKey, candidate.name AS name
```

### Falkor query limitations to know about

Embedded FalkorDB does not support every Cypher form you might expect from Neo4j-style examples.

In particular, avoid relying on:

- `OPTIONAL MATCH shortestPath(...)`
- undirected `shortestPath((a)-[:MENTORS*1..2]-(b))`
- some variable-length undirected visual inspection queries in the browser

If a browser query fails, prefer the explicit direction-specific queries above. That is also how the app now preserves SQL fallback parity in the production read path.

## Troubleshooting

### `suggest_connections` always falls back to SQL

Check:

- `FALKOR_ENABLED=true`
- remote or embedded config is actually present
- Falkor process is reachable
- the org graph has been backfilled and synced

If quick member/event/parent queries in the AI panel are healthy but connection prompts still error, that usually means the chat routing and tool-only execution-policy path are fine and the issue is isolated to the Falkor/suggestions stack instead.

### `suggest_connections` errors immediately in local chat

Check:

- `src/lib/falkordb/suggestions.ts` and `src/lib/falkordb/scoring.ts` still agree on exported helper names, especially `normalizeConnectionText`
- the local branch does not have unresolved Falkor refactors that leave the tool importable but partially broken
- after fixing the import issue, rerun direct-name prompts such as "Who should Matt connect with?" before debugging graph freshness or ranking

### Queue rows keep retrying

Inspect `graph_sync_queue.error` and `attempts`. The worker re-enqueues failed items by incrementing attempts and clearing `processed_at`.

### Freshness stays stale

Usually one of these is true:

- the cron route is not running
- `CRON_SECRET` is missing or wrong
- Falkor is unavailable so queue work is never processed
- there is a backlog of pending graph sync rows for the org

### Graph has missing people or stale identities

Backfill the org again and drain the queue. This is especially useful after:

- enabling Falkor for the first time
- fixing a sync bug
- changing historical `user_id` values
- importing a large batch of members or alumni
