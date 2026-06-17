-- Drop the graph_sync_queue table and its worker RPCs (Option A: people-graph served from Postgres).
--
-- The enqueue triggers + trigger functions were removed in 20261221000000. With the FalkorDB sync
-- pipeline retired (cron + sync.ts/drift.ts/client.ts deleted in the same change), nothing reads or
-- writes this queue. Remove the table and its dequeue/increment/purge/backfill RPCs.
--
-- KEPT: get_mentorship_distances(uuid, uuid) — the Postgres-native recursive-CTE traversal the app
-- standardizes on. It reads mentorship_pairs directly and does not touch graph_sync_queue.

DROP FUNCTION IF EXISTS public.backfill_graph_sync_queue(uuid);
DROP FUNCTION IF EXISTS public.dequeue_graph_sync_queue(integer);
DROP FUNCTION IF EXISTS public.increment_graph_sync_attempts(uuid, text);
DROP FUNCTION IF EXISTS public.purge_graph_sync_queue();
DROP FUNCTION IF EXISTS public.purge_graph_sync_queue_disabled();

DROP TABLE IF EXISTS public.graph_sync_queue;
