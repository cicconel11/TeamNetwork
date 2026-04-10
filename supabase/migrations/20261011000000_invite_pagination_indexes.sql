-- Invite system pagination indexes
-- Supports cursor and offset pagination on invite/membership queries

CREATE INDEX IF NOT EXISTS idx_org_invites_org_created
  ON public.organization_invites (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enterprise_invites_ent_created
  ON public.enterprise_invites (enterprise_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_org_roles_pending
  ON public.user_organization_roles (organization_id, status, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_user_org_roles_org_created
  ON public.user_organization_roles (organization_id, created_at DESC);
