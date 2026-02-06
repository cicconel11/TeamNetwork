-- =====================================================
-- Migration: Chat Group Member Management
-- =====================================================
-- Adds support for adding/removing members post-creation:
-- - added_by: tracks who added the member
-- - removed_at: soft-removal timestamp (NULL = active)
-- - Updated helper functions to filter out removed members
-- - New is_chat_group_creator() helper
-- - Rebuilt RLS policies for member management

-- =====================================================
-- Schema changes
-- =====================================================
ALTER TABLE public.chat_group_members
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.chat_group_members
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

-- Backfill added_by from chat_groups.created_by for existing rows
UPDATE public.chat_group_members cgm
SET added_by = cg.created_by
FROM public.chat_groups cg
WHERE cgm.chat_group_id = cg.id
  AND cgm.added_by IS NULL;

-- Partial index for active members (most queries filter on removed_at IS NULL)
CREATE INDEX IF NOT EXISTS chat_group_members_active_idx
  ON public.chat_group_members (chat_group_id, user_id)
  WHERE removed_at IS NULL;

-- =====================================================
-- Update is_chat_group_member to exclude removed members
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_chat_group_member(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT TRUE
     FROM public.chat_group_members cgm
     WHERE cgm.chat_group_id = group_id
       AND cgm.user_id = auth.uid()
       AND cgm.removed_at IS NULL
     LIMIT 1),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_group_member(uuid) TO authenticated;

-- =====================================================
-- Update is_chat_group_moderator to exclude removed members
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_chat_group_moderator(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT TRUE
     FROM public.chat_group_members cgm
     WHERE cgm.chat_group_id = group_id
       AND cgm.user_id = auth.uid()
       AND cgm.role IN ('admin', 'moderator')
       AND cgm.removed_at IS NULL
     LIMIT 1),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_group_moderator(uuid) TO authenticated;

-- =====================================================
-- New helper: is_chat_group_creator
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_chat_group_creator(group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT TRUE
     FROM public.chat_groups cg
     WHERE cg.id = group_id
       AND cg.created_by = auth.uid()
       AND cg.deleted_at IS NULL
     LIMIT 1),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_group_creator(uuid) TO authenticated;

-- =====================================================
-- Rebuild chat_group_members RLS policies
-- =====================================================

-- SELECT: Active members see active members in their groups;
-- admins/moderators/creators can also see removed members for management
DROP POLICY IF EXISTS chat_group_members_select ON public.chat_group_members;
CREATE POLICY chat_group_members_select ON public.chat_group_members
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      -- Active members can see other active members in groups they belong to
      (
        removed_at IS NULL
        AND is_chat_group_member(chat_group_id) = TRUE
      )
      OR (
        -- Admins, moderators, and creators can see removed members for management
        (
          has_active_role(organization_id, array['admin'])
          OR is_chat_group_moderator(chat_group_id) = TRUE
          OR is_chat_group_creator(chat_group_id) = TRUE
        )
      )
    )
  );

-- INSERT: Org admins, group moderators, or group creator can add members
DROP POLICY IF EXISTS chat_group_members_insert ON public.chat_group_members;
CREATE POLICY chat_group_members_insert ON public.chat_group_members
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR is_chat_group_creator(chat_group_id) = TRUE
  );

-- UPDATE: Org admins, group moderators, group creator, or self
-- (self can update last_read_at, leave group via removed_at)
DROP POLICY IF EXISTS chat_group_members_update ON public.chat_group_members;
CREATE POLICY chat_group_members_update ON public.chat_group_members
  FOR UPDATE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id) = TRUE
    OR is_chat_group_creator(chat_group_id) = TRUE
    OR user_id = auth.uid()
  );

-- DELETE: Org admins only (hard cleanup)
DROP POLICY IF EXISTS chat_group_members_delete ON public.chat_group_members;
CREATE POLICY chat_group_members_delete ON public.chat_group_members
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
  );
