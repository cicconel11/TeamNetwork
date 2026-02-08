-- Tighten organization_invites SELECT policy to admin-only.
--
-- The old policy allowed ANY authenticated user to read ALL active invite
-- records (tokens, codes, roles, org IDs) across ALL organizations via:
--   OR (token IS NOT NULL AND revoked_at IS NULL)
--
-- This is safe because:
--   1. The join flow uses `redeem_org_invite` RPC (SECURITY DEFINER) which
--      bypasses RLS entirely.
--   2. All direct table queries come from admin pages (settings/invites/,
--      settings/approvals/) that already filter by organization_id.
--   3. Organization deletion uses service client which bypasses RLS.

DROP POLICY IF EXISTS organization_invites_select ON public.organization_invites;

CREATE POLICY organization_invites_select ON public.organization_invites
FOR SELECT USING (
  has_active_role(organization_id, array['admin'])
);
