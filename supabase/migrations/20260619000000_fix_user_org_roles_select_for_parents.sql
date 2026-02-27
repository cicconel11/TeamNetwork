-- Allow all active org members to see other ACTIVE role rows in their org.
-- Previously only admins could see other users' roles, breaking the Members
-- page for active_members, alumni, and parents.
--
-- Security model:
-- - You can always see your own row (any status)
-- - Admins can see ALL rows (any status, including pending/revoked)
-- - Active members, alumni, parents can see other ACTIVE rows only
DROP POLICY IF EXISTS user_org_roles_select ON public.user_organization_roles;
CREATE POLICY user_org_roles_select ON public.user_organization_roles
  FOR SELECT USING (
    user_id = auth.uid()
    OR has_active_role(organization_id, ARRAY['admin'])
    OR (
      status = 'active'
      AND has_active_role(organization_id, ARRAY['active_member','alumni','parent'])
    )
  );
