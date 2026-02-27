-- Add protect_parents_self_edit trigger
--
-- Risk 3: Defense-in-depth for parent self-edit pathway.
--   The parents_update RLS policy (20260609000000) allows user_id=auth.uid() to UPDATE.
--   Without a trigger, a malicious self-editor could change user_id (unlinking their auth
--   account from the record), change organization_id (org-hopping), or set deleted_at
--   (soft-deleting their own record).
--
--   This trigger blocks those mutations for non-admins, mirroring protect_alumni_self_edit.
--   Service-role callers (backend operations) bypass all checks.

CREATE OR REPLACE FUNCTION public.protect_parents_self_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Service-role callers bypass all checks (admin operations, backend sync)
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Only restrict non-admins (i.e. self-edit pathway via parents_update policy)
  IF NOT public.is_org_admin(OLD.organization_id) THEN
    -- user_id: allow linking yourself to a previously-unlinked record, nothing else
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      IF NOT (OLD.user_id IS NULL AND NEW.user_id = (SELECT auth.uid())) THEN
        RAISE EXCEPTION 'Cannot change user_id on parent self-edit';
      END IF;
    END IF;

    -- organization_id: never allowed on self-edit
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on parent self-edit';
    END IF;

    -- deleted_at: only admins may soft-delete
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only admins can soft-delete parent records';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_parents_self_edit ON public.parents;

CREATE TRIGGER protect_parents_self_edit
  BEFORE UPDATE ON public.parents
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_parents_self_edit();
