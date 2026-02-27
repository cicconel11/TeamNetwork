-- Fix parents RLS policies
--
-- Risk 2: Add 'parent' role to parents SELECT policy.
--   Parent-role users were blocked from reading the parents directory in their org.
--   This mirrors alumni_select which includes 'alumni' in the has_active_role check.
--
-- Risk 7: Wire can_add_parents() into parents INSERT policy.
--   can_add_parents() was defined but never called from RLS. Consistent with the
--   alumni INSERT pattern: is_org_admin AND can_add_alumni(). Currently always
--   returns true (parents are unlimited), but wiring it in means a future
--   capacity enforcement migration only needs to update the function body.

-- ── parents SELECT: add 'parent' role ────────────────────────────────────────

DROP POLICY IF EXISTS "parents_select" ON public.parents;

CREATE POLICY "parents_select" ON public.parents FOR SELECT
  USING (
    public.has_active_role(
      organization_id,
      ARRAY['admin'::text, 'active_member'::text, 'parent'::text]
    )
  );

-- ── parents INSERT: add quota guard (no-op today; ready for future enforcement) ─

DROP POLICY IF EXISTS "parents_insert" ON public.parents;

CREATE POLICY "parents_insert" ON public.parents FOR INSERT
  WITH CHECK (
    public.is_org_admin(organization_id)
    AND public.can_add_parents(organization_id)
  );
