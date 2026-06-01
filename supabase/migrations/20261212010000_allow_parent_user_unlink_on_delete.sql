-- Allow the FK ON DELETE SET NULL cascade to unlink parents.user_id during account deletion.
--
-- WHY: parents.user_id is ON DELETE SET NULL. When auth.admin.deleteUser() runs, GoTrue deletes
-- the auth.users row over its own connection (no PostgREST request context), so auth.role() is NULL
-- -- NOT 'service_role'. The BEFORE UPDATE trigger protect_parents_self_edit() therefore falls into
-- the non-admin branch and RAISEs 'Cannot change user_id on parent self-edit', aborting the whole
-- delete. This has silently broken account deletion for every parent-linked user since 2026-06-16.
--
-- FIX: permit the user_id -> NULL transition (the cascade / admin unlink). The parents_update RLS
-- policy already restricts WHO may issue an UPDATE (org admin or the linked user), so allowing the
-- unlink does not weaken the self-edit threat model: a self-editor can only orphan their own row.
--
-- NOTE: an analogous protect_alumni_self_edit() guard exists ONLY in old migrations, not in the
-- live DB (its trigger was dropped). alumni.user_id is SET NULL and does NOT block deletion today.
-- We intentionally do NOT patch it here to avoid recreating a dropped function with a guessed body;
-- if that guard is ever re-added, it must carry the same NEW.user_id IS NULL unlink exemption.

CREATE OR REPLACE FUNCTION public.protect_parents_self_edit()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_org_admin(OLD.organization_id) THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      -- Allowed transitions for a non-admin:
      --   * link self:   OLD.user_id IS NULL AND NEW.user_id = auth.uid()
      --   * unlink:       NEW.user_id IS NULL  (FK SET NULL cascade on user deletion, or admin unlink)
      IF NOT (
        (OLD.user_id IS NULL AND NEW.user_id = (SELECT auth.uid()))
        OR NEW.user_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Cannot change user_id on parent self-edit';
      END IF;
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Cannot change organization_id on parent self-edit';
    END IF;

    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only admins can soft-delete parent records';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
