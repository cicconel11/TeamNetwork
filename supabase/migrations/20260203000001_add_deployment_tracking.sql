-- Migration: Add deployment tracking columns to error_events
-- Description: Track deployment_id and git_sha for correlating errors with deployments

-- =============================================================================
-- Add deployment tracking columns to error_events
-- =============================================================================

ALTER TABLE error_events ADD COLUMN IF NOT EXISTS deployment_id text;
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS git_sha text;

-- Comment on new columns
COMMENT ON COLUMN error_events.deployment_id IS 'Vercel deployment ID (e.g., dpl_abc123)';
COMMENT ON COLUMN error_events.git_sha IS 'Git commit SHA (truncated to 7 chars)';

-- =============================================================================
-- Index for querying errors by deployment
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_error_events_deployment
  ON error_events (deployment_id)
  WHERE deployment_id IS NOT NULL;
