-- Performance indexes for analytics tables

-- =============================================================================
-- Indexes for analytics_events table
-- =============================================================================

-- Index for org-scoped time-range queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_analytics_events_org_created
  ON public.analytics_events (org_id, created_at DESC);

-- Index for session-based lookups
CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON public.analytics_events (session_id);

-- =============================================================================
-- BRIN index for ops_events (append-only time-series data)
-- =============================================================================

-- BRIN is perfect for append-only time-series: minimal storage, fast range scans
CREATE INDEX IF NOT EXISTS idx_ops_events_created_brin
  ON public.ops_events USING BRIN (created_at);

-- =============================================================================
-- Indexes for usage_summaries table
-- =============================================================================

-- Index for user dashboard queries (user-scoped, most recent first)
CREATE INDEX IF NOT EXISTS idx_usage_summaries_user_org_period
  ON public.usage_summaries (user_id, organization_id, period_start DESC);
