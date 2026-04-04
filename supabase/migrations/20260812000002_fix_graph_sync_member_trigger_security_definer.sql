-- Fix: enqueue_graph_sync_member runs as calling user (SECURITY INVOKER),
-- which fails because graph_sync_queue has RLS enabled with no policies.
-- The alumni and mentorship_pairs triggers are already SECURITY DEFINER.
-- Make this consistent.

ALTER FUNCTION enqueue_graph_sync_member() SECURITY DEFINER;
ALTER FUNCTION enqueue_graph_sync_member() SET search_path = public;
