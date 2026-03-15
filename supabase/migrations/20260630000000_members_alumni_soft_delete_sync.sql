-- Members & Alumni soft-delete sync
--
-- When a member or alumni record is soft-deleted (deleted_at transitions
-- NULL → non-null), revoke the user's org access in user_organization_roles.
--
-- This mirrors the proven handle_parents_soft_delete trigger pattern,
-- ensuring deletion from ANY path (UI, API, manual DB) atomically
-- revokes access.

-- ── Trigger 1: Members ──

CREATE OR REPLACE FUNCTION public.handle_members_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only act when deleted_at transitions NULL → non-null and user_id is set.
  -- Rows without a user_id are directory-only records with no auth account to revoke.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    UPDATE public.user_organization_roles
    SET status = 'revoked'
    WHERE user_id = NEW.user_id
      AND organization_id = NEW.organization_id
      AND role IN ('active_member', 'admin', 'member');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS members_soft_delete_sync ON public.members;

CREATE TRIGGER members_soft_delete_sync
  AFTER UPDATE OF deleted_at ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_members_soft_delete();

-- ── Trigger 2: Alumni ──

CREATE OR REPLACE FUNCTION public.handle_alumni_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only act when deleted_at transitions NULL → non-null and user_id is set.
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.user_id IS NOT NULL THEN
    UPDATE public.user_organization_roles
    SET status = 'revoked'
    WHERE user_id = NEW.user_id
      AND organization_id = NEW.organization_id
      AND role = 'alumni';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS alumni_soft_delete_sync ON public.alumni;

CREATE TRIGGER alumni_soft_delete_sync
  AFTER UPDATE OF deleted_at ON public.alumni
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_alumni_soft_delete();
