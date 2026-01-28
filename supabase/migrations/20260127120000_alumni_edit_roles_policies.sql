-- Alumni RLS policies: respect nav-configured editRoles (like donations/philanthropy)
--
-- Previously alumni INSERT/DELETE required is_org_admin(), ignoring the
-- nav_config.editRoles setting that admins can configure in the navigation
-- settings UI. This migration aligns alumni with the pattern established
-- in 20260102010000_nav_edit_roles_policies.sql for donations/philanthropy.

-- Alumni INSERT: replace is_org_admin with can_edit_page, keep quota check
DROP POLICY IF EXISTS alumni_insert ON public.alumni;
CREATE POLICY alumni_insert ON public.alumni
  FOR INSERT
  WITH CHECK (
    public.can_edit_page(organization_id, '/alumni')
    AND public.can_add_alumni(organization_id)
  );

-- Alumni UPDATE: add can_edit_page alongside existing self-edit pathway
DROP POLICY IF EXISTS alumni_update ON public.alumni;
CREATE POLICY alumni_update ON public.alumni
  FOR UPDATE
  USING (
    public.can_edit_page(organization_id, '/alumni')
    OR (
      (user_id = (SELECT auth.uid()))
      AND public.has_active_role(organization_id, ARRAY['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  )
  WITH CHECK (
    public.can_edit_page(organization_id, '/alumni')
    OR (
      (user_id = (SELECT auth.uid()))
      AND public.has_active_role(organization_id, ARRAY['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  );

-- Alumni DELETE: replace is_org_admin with can_edit_page
DROP POLICY IF EXISTS alumni_delete ON public.alumni;
CREATE POLICY alumni_delete ON public.alumni
  FOR DELETE
  USING (public.can_edit_page(organization_id, '/alumni'));

-- Protective trigger: prevent self-editors from changing protected columns.
-- RLS policies only gate row-level access; they cannot restrict which columns
-- are modified. Without this trigger, a self-editing user could:
--   1. Change organization_id to another org where they have a role (cross-tenant)
--   2. Set deleted_at to soft-delete their own record (bypassing UI gate)
--   3. Change user_id to detach ownership
-- Page editors (via can_edit_page) are NOT restricted by this trigger.
CREATE OR REPLACE FUNCTION public.protect_alumni_self_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role callers bypass all checks (backend sync, backfill jobs)
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only restrict non-page-editors (self-edit pathway)
  IF NOT public.can_edit_page(OLD.organization_id, '/alumni') THEN
    -- user_id: only allow adding a link to yourself (OLD is NULL, NEW is you)
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      IF NOT (OLD.user_id IS NULL AND NEW.user_id = (SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Cannot change user_id on alumni self-edit';
      END IF;
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on alumni self-edit';
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only page editors can soft-delete alumni records';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alumni_protect_self_edit ON public.alumni;
CREATE TRIGGER alumni_protect_self_edit
  BEFORE UPDATE ON public.alumni
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_alumni_self_edit();
