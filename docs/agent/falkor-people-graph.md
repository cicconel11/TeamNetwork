# Falkor People Graph

## Overview

The Falkor people graph powers the AI tool `suggest_connections`, which recommends member and alumni outreach targets for an organization. The graph is org-scoped, built from `members`, `alumni`, and `mentorship_pairs`, and is designed to have a SQL fallback with equivalent ranking semantics when Falkor is disabled or unavailable.

The runtime has two paths:

- `mode: "falkor"`: read candidate people from Falkor and score them in app code.
- `mode: "sql_fallback"`: load the org projection and mentorship distances directly from Supabase and score them with the same deterministic weights.

Relevant code:

- `src/lib/falkordb/client.ts`: Falkor connection and config
- `src/lib/falkordb/people.ts`: projection model and person-key rules
- `src/lib/falkordb/suggestions.ts`: `suggest_connections` read path
- `src/lib/falkordb/sync.ts`: graph sync worker
- `src/app/api/cron/graph-sync-process/route.ts`: queue drain route
- `supabase/migrations/20260715000000_falkor_people_graph_foundation.sql`: queue, triggers, RPCs
- `supabase/migrations/20260715000001_graph_sync_queue_org_freshness_index.sql`: freshness query index

## Graph Model

The graph stores `Person` nodes plus directed `MENTORS` edges.

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

Identity is keyed by `personKey`, not raw row id:

- `user:<user_id>` when the member/alumni rows share a real user
- `member:<member_id>` when an active member has no `user_id`
- `alumni:<alumni_id>` when an alumni row has no `user_id`

This lets the graph merge member + alumni records for the same real person while still representing unlinked rows cleanly.

### Mentorship edges

`mentorship_pairs` become directed `(:Person)-[:MENTORS]->(:Person)` edges using mentor and mentee `user_id` values. If a pair is deleted or becomes inactive, the edge is removed on the next sync pass.

## How Sync Works

The graph is updated asynchronously through `graph_sync_queue`.

### 1. Database triggers enqueue work

The migration adds trigger functions for:

- `members`
- `alumni`
- `mentorship_pairs`

Each trigger compares the old and new row. If a relevant field changed, it writes a queue row with:

- `org_id`
- `source_table`
- `source_id`
- `action`
- `payload`

The payload carries old keys like prior `user_id`, prior `organization_id`, or prior mentorship endpoints so the worker can reconcile both the old graph identity and the new one.

### 2. Cron route drains the queue

`GET /api/cron/graph-sync-process` calls `processGraphSyncQueue()` in a loop for up to 25 seconds, then purges old processed/dead-letter rows.

Auth is bearer-token based:

```text
Authorization: Bearer $CRON_SECRET
```

If `CRON_SECRET` is missing, the route returns a 500 and sync will not run.

### 3. Worker reconciles graph state

For people rows:

- load all active rows that belong to the resolved graph identity
- rebuild the projected person
- upsert the `Person` node if a live projection exists
- delete the node if no live projection remains
- reconcile mentorship edges for the person if they have a `userId`

For mentorship pairs:

- reconcile both the old and current mentor/mentee endpoints
- add or remove the `MENTORS` edge depending on current DB truth

The worker is intentionally reconciliatory: it does not trust the queue payload as the full source of truth, and instead re-reads the current DB state before deciding what the graph should look like.

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

If Falkor is disabled, unavailable, or a graph query throws, the feature falls back to SQL and still returns ranked results. This keeps the tool usable during setup, outages, or local development without Falkor.

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
