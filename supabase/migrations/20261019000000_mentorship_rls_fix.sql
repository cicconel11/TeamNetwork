-- Fix mentor_profiles update/delete RLS policies to require active org role.
-- Previously only checked user_id = auth.uid(), allowing revoked users to
-- modify their mentor profiles.

ALTER POLICY "mentor_profiles_update" ON mentor_profiles
  USING (
    user_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni'])
  )
  WITH CHECK (
    user_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni'])
  );

ALTER POLICY "mentor_profiles_delete" ON mentor_profiles
  USING (
    user_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni'])
  );
