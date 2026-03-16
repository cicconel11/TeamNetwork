-- Composite index for the unified calendar events query.
-- The query filters by organization_id + start_date range with deleted_at IS NULL.
-- Previously only separate indexes existed on organization_id and start_date.
CREATE INDEX IF NOT EXISTS idx_events_org_start
ON events(organization_id, start_date)
WHERE deleted_at IS NULL;
