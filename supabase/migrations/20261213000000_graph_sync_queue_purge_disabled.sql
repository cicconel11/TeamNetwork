-- Add purge_graph_sync_queue_disabled(): compatibility no-op.
--
-- WHY: this RPC briefly deleted unprocessed graph_sync_queue rows while Falkor was unavailable.
-- That made a transient env/config blip destructive: valid pending graph intents could be lost
-- before Falkor returned. Keep the function name for deploy compatibility, but make it safe.
--
-- The normal purge_graph_sync_queue remains responsible for processed and dead-letter rows.

CREATE OR REPLACE FUNCTION public.purge_graph_sync_queue_disabled()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.purge_graph_sync_queue_disabled IS
  'Compatibility no-op. Pending graph_sync_queue rows must not be purged solely because Falkor is unavailable.';

REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_graph_sync_queue_disabled TO service_role;
