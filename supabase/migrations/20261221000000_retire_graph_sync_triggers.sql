-- Retire the FalkorDB people-graph sync pipeline (Option A: serve the graph from Postgres).
--
-- WHY: FalkorDB was never enabled in production (no FALKOR_* config / instance), so the
-- `graph_sync_queue` triggers enqueued member/alumni/pair changes that nothing ever drained
-- (~358 rows accrued, oldest 2026-06-01). The mentor-suggestion feature already runs entirely
-- on Postgres + pgvector via the SQL-fallback path, and `get_mentorship_distances()` provides
-- recursive-CTE graph traversal natively. We are making that the permanent architecture.
--
-- This migration stops the write side of the dormant pipeline:
--   * drops the three enqueue triggers + their trigger functions (the source of the leak)
--   * clears the orphaned backlog (no consumer exists under Option A — these rows are dead weight)
--
-- Intentionally KEPT (still referenced or useful):
--   * graph_sync_queue table + dequeue/increment/purge/backfill RPCs (removed in the code-cleanup
--     follow-up, once the cron route and sync.ts reader are deleted together)
--   * get_mentorship_distances() — the Postgres-native traversal we are standardizing on
--
-- Reversible: re-running 20260715000000_falkor_people_graph_foundation.sql recreates the triggers.

-- 1. Drop triggers first (they depend on the functions).
DROP TRIGGER IF EXISTS trg_graph_sync_members ON public.members;
DROP TRIGGER IF EXISTS trg_graph_sync_alumni ON public.alumni;
DROP TRIGGER IF EXISTS trg_graph_sync_mentorship_pairs ON public.mentorship_pairs;

-- 2. Drop the now-unused trigger functions.
DROP FUNCTION IF EXISTS public.enqueue_graph_sync_member();
DROP FUNCTION IF EXISTS public.enqueue_graph_sync_alumni();
DROP FUNCTION IF EXISTS public.enqueue_graph_sync_mentorship_pair();

-- 3. Clear the orphaned backlog. Under Option A nothing will ever process these rows.
DELETE FROM public.graph_sync_queue;
