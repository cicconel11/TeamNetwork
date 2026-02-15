-- Fix job_postings index to match actual query patterns
-- Queries sort by created_at DESC, not expires_at
DROP INDEX IF EXISTS idx_job_postings_listing;

CREATE INDEX idx_job_postings_listing ON public.job_postings (
  organization_id, is_active, deleted_at, created_at DESC
)
WHERE deleted_at IS NULL AND is_active = true;
