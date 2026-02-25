-- Allow admins OR the linked user to update their own parent record
DROP POLICY IF EXISTS "parents_update" ON public.parents;

CREATE POLICY "parents_update" ON public.parents FOR UPDATE
  USING (
    public.is_org_admin(organization_id)
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  );
