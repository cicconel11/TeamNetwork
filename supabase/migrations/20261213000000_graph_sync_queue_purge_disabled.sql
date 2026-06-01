-- Add purge_graph_sync_queue_disabled(): reaps pending graph_sync_queue rows when Falkor is OFF.
--
-- WHY: the trg_graph_sync_* triggers enqueue member/alumni/pair changes unconditionally (Postgres
-- can't read app env). In production Falkor is disabled by design (FALKOR_ENABLED unset; SQL fallback
-- is the guaranteed path), so the consumer (processGraphSyncQueue) early-returns without dequeuing.
-- Those rows sit processed_at=NULL, attempts=0 forever, and the normal purge_graph_sync_queue only
-- reaps `processed_at IS NOT NULL OR attempts >= 3` -- so the queue grows unbounded (434 dead rows,
-- oldest 2 months at time of writing).
--
-- This RPC deletes exactly the rows the normal purge can't touch: unprocessed and not-yet-dead-letter
-- (processed_at IS NULL AND attempts < 3). It is ONLY called from the consumer's disabled branch, so
-- discarding pending graph-sync intents is safe -- the people-graph is optional, and if Falkor is
-- later enabled the full state is reconstructable via backfill_graph_sync_queue(org_id).
--
-- Mirrors the existing purge_graph_sync_queue exactly: SECURITY DEFINER, search_path='', batched
-- LIMIT 1000, GET DIAGNOSTICS row count, REVOKE from PUBLIC/anon/authenticated + GRANT to service_role.

CREATE OR REPLACE FUNCTION public.purge_graph_sync_queue_disabled()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.graph_sync_queue
    WHERE processed_at IS NULL
      AND attempts < 3
    ORDER BY created_at
    LIMIT 1000
  )
  DELETE FROM public.graph_sync_queue
  WHERE id IN (SELECT id FROM doomed);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.purge_graph_sync_queue_disabled IS
  'Drains pending graph_sync_queue rows when Falkor is disabled (consumer cannot process them). Safe to discard: people-graph is optional and reconstructable via backfill_graph_sync_queue.';

REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled TO service_role;
