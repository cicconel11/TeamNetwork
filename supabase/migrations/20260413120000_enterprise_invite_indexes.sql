-- Add performance indexes for enterprise invites
-- Issue 13: Partial index for active enterprise invite code lookups
-- Issue 14: Compound partial index for admin cap COUNT query

-- Index for redeem_enterprise_invite's code lookup (common path)
CREATE INDEX idx_enterprise_invites_code_active
  ON enterprise_invites(code)
  WHERE revoked_at IS NULL;

-- Index for admin cap pre-check and GET endpoint's admin count query
CREATE INDEX idx_uor_org_role_status_active
  ON user_organization_roles(organization_id, role, status)
  WHERE status = 'active';
