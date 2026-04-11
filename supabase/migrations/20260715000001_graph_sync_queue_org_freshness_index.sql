-- Index for org-scoped freshness check in suggest-connections
-- (dequeue RPC uses the existing global idx_graph_sync_queue_pending)
CREATE INDEX idx_graph_sync_queue_org_freshness
  ON public.graph_sync_queue(org_id, created_at)
  WHERE processed_at IS NULL AND attempts < 3;
