-- Fix: enqueue_graph_sync_member runs as calling user (SECURITY INVOKER),
-- which fails because graph_sync_queue has RLS enabled with no policies.
-- The alumni and mentorship_pairs triggers are already SECURITY DEFINER.
-- Make this consistent.
--
-- The function body (set in 20260715000002_fix_graph_sync_member_enum_coalesce.sql)
-- fully qualifies all references (public.graph_sync_queue, jsonb_build_object
-- which lives in pg_catalog), so we keep search_path = '' to satisfy the
-- function_search_path_mutable linter rule.

ALTER FUNCTION public.enqueue_graph_sync_member() SECURITY DEFINER;
ALTER FUNCTION public.enqueue_graph_sync_member() SET search_path = '';
