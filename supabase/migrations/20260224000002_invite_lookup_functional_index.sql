-- Migration: Add functional index for invite code lookup
--
-- redeem_org_invite queries:
--   WHERE (upper(code) = upper(trim(p_code)) OR token = trim(p_code))
--     AND revoked_at IS NULL
--
-- The token branch is already covered by organization_invites_token_idx.
-- The upper(code) branch forces a sequential scan (1,067 seq scans, ~71ms avg).
-- This partial functional index allows PostgreSQL to use an index scan for
-- the upper(code) = upper(trim(p_code)) condition without touching revoked rows.

CREATE INDEX IF NOT EXISTS organization_invites_upper_code_idx
  ON public.organization_invites (upper(code))
  WHERE revoked_at IS NULL;
