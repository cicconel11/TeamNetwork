# Falkor People Graph

## Overview

The Falkor people graph powers the AI tool `suggest_connections`, which recommends member and alumni outreach targets for an organization. The graph is org-scoped, built from `members`, `alumni`, and `mentorship_pairs`. Falkor and SQL fallback share the same scoring (see **Step 6** and **Step 7**).

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

### Step 2 — Infrastructure (`client.ts`)

`FalkorClientImpl` manages the connection. Config resolves from env vars in priority order: `FALKOR_URL` (remote) → `FALKOR_HOST` (remote discrete) → `FALKOR_EMBEDDED` (local dev with falkordblite). Each org gets its own graph named `teamnetwork_people_<orgId>`. The `FalkorQueryClient` interface is the DI seam — tests inject stubs here.

### Step 3 — Database foundation (migration SQL)

Triggers on `members`, `alumni`, and `mentorship_pairs` fire on INSERT/UPDATE, compare relevant fields, and enqueue changed rows to `graph_sync_queue` with old-key context in the payload. Four service-role RPCs: `dequeue_graph_sync_queue` (SKIP LOCKED for concurrency), `increment_graph_sync_attempts`, `purge_graph_sync_queue`, `backfill_graph_sync_queue`. Plus `get_mentorship_distances` — a recursive CTE that walks mentorship edges up to depth 2 for the SQL fallback.

### Step 4 — Write path (`sync.ts`)

Queue items are processed per `source_table`. For people: re-read all active source rows for the identity key, rebuild the projection, upsert or delete the `Person` node, then reconcile adjacent `MENTORS` edges. For mentorship pairs: reconcile both old and current endpoints. The worker is reconciliatory — it never trusts the queue payload as source of truth; it always re-reads current DB state.

### Step 5 — Cron endpoint (`route.ts`)

`GET /api/cron/graph-sync-process` loops `processGraphSyncQueue` for up to 25 seconds, then purges rows older than 7 days. Auth via `CRON_SECRET` bearer token.

### Step 6 — Scoring (`scoring.ts`)

Seven weighted reason codes; Falkor and SQL paths use identical scoring:

| Reason | Weight |
|--------|--------|
| `direct_mentorship` | 100 |
| `second_degree_mentorship` | 50 |
| `shared_company` | 20 |
| `shared_industry` | 12 |
| `shared_major` | 10 |
| `shared_graduation_year` | 8 |
| `shared_city` | 5 |

Score = sum of matching weights. Deterministic tie-breaking: score → reason count → name → `person_id`.

### Step 7 — Read path (`suggestions.ts`)

`suggestConnections()` is the main entry. It resolves the source person with cross-table complement (loads both member and alumni rows for the same user), then branches:

- **Falkor mode:** parallel Cypher queries — all candidates plus six directed mentorship distance queries (outgoing d=1, incoming d=1, four mixed-direction d=2 patterns). Scores in app code.
- **SQL fallback:** loads full org projection and mentorship distances via the recursive CTE RPC. Scores identically.

If Falkor throws, the implementation silently falls back to SQL.

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

The graph stores only `Person` nodes and `MENTORS` edges today. There are no event or interaction edges, no group-membership edges, and no weighted graph affinity — scoring is attribute-based (shared company, industry, etc.) plus mentorship proximity. Expanding the graph model (e.g. shared event attendance, chat interactions, discussion co-participation) is a natural next step if richer recommendations are needed.

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

Before querying Falkor, the app builds a source projection using the same merge rules as the full SQL projection:

- if the source has a `user_id`, it loads all matching complement rows from the other table
- it then builds a single merged source person

This matters because scoring reasons like shared company or shared graduation year depend on the merged source attributes, not just the row the admin clicked on.

### Freshness

The read path checks the oldest pending queue item for the org:

- if lag is low, freshness is `fresh`
- if lag exceeds `GRAPH_STALE_AFTER_SECONDS`, freshness is `stale`

The per-org freshness lookup is supported by:

- `idx_graph_sync_queue_org_freshness`

### Fallback behavior

Same as **Step 7** (disabled/unavailable Falkor or thrown graph query → SQL, still ranked). This keeps the tool usable during setup, outages, or local dev without Falkor.

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
