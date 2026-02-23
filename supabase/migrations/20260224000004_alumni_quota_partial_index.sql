-- Migration: Add partial index for alumni quota COUNT queries
--
-- get_alumni_quota executes:
--   SELECT COUNT(*) FROM alumni WHERE organization_id = p_org_id AND deleted_at IS NULL
--
-- No partial index existed for this pattern, causing full table scans.
-- This index enables Index Only Scans for the quota check (33ms avg × 12 calls = ~397ms total).

CREATE INDEX IF NOT EXISTS alumni_org_active_count_idx
  ON public.alumni (organization_id)
  WHERE deleted_at IS NULL;
