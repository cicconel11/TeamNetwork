-- =====================================================
-- Migration: Fix Chat Group Visibility for Non-Members
-- =====================================================
-- Issue: Users who are not members of a chat group can still see
-- the group on the chat page. This includes admins who should also
-- only see groups they are explicitly members of.
--
-- Root cause: The RLS policies had an exception allowing org admins
-- to see all groups, and the is_chat_group_member function may return
-- NULL in edge cases.
--
-- Fix: 
-- 1. Update is_chat_group_member to use COALESCE to ensure boolean return
-- 2. Remove admin exceptions - ALL users must be group members to see groups
-- 3. Update all chat-related RLS policies consistently

-- =====================================================
-- Fix the is_chat_group_member function
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
     LIMIT 1),
    FALSE
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_chat_group_member(uuid) TO authenticated;

-- =====================================================
-- Fix the is_chat_group_moderator function (same pattern)
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
     LIMIT 1),
    FALSE
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_chat_group_moderator(uuid) TO authenticated;

-- =====================================================
-- Recreate RLS policy for chat_groups with explicit logic
-- =====================================================
-- Users can see groups they are members of.
-- Admins can also see groups they created OR soft-deleted groups
-- (needed for INSERT...RETURNING and UPDATE...RETURNING after soft-delete)
DROP POLICY IF EXISTS chat_groups_select ON public.chat_groups;
CREATE POLICY chat_groups_select ON public.chat_groups
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      -- Regular case: non-deleted groups where user is a member
      (
        deleted_at IS NULL
        AND is_chat_group_member(id) = TRUE
      )
      OR (
        -- Allow admins to see groups they created (for INSERT...RETURNING)
        deleted_at IS NULL
        AND created_by = auth.uid()
        AND has_active_role(organization_id, array['admin'])
      )
      OR (
        -- Allow admins to see soft-deleted groups (for UPDATE...RETURNING after delete)
        deleted_at IS NOT NULL
        AND has_active_role(organization_id, array['admin'])
      )
    )
  );

-- =====================================================
-- Also fix chat_group_members SELECT policy
-- =====================================================
-- Users can only see members of groups they belong to
-- Also allow group creators (admins) to see members for management
DROP POLICY IF EXISTS chat_group_members_select ON public.chat_group_members;
CREATE POLICY chat_group_members_select ON public.chat_group_members
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      is_chat_group_member(chat_group_id) = TRUE
      OR (
        -- Allow admins who created the group to see members
        EXISTS (
          SELECT 1 FROM public.chat_groups cg
          WHERE cg.id = chat_group_id
            AND cg.created_by = auth.uid()
            AND cg.deleted_at IS NULL
        )
        AND has_active_role(organization_id, array['admin'])
      )
    )
  );

-- =====================================================
-- Fix chat_messages SELECT policy - remove admin exception
-- =====================================================
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND (
      status = 'approved'
      OR author_id = auth.uid()
      OR is_chat_group_moderator(chat_group_id) = TRUE
    )
  );

-- =====================================================
-- Fix chat_messages INSERT policy - remove admin exception
-- =====================================================
DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND author_id = auth.uid()
  );


-- =====================================================
-- Fix chat_groups UPDATE policy for soft-deletes
-- =====================================================
-- Admins need to be able to soft-delete groups (set deleted_at)
-- The WITH CHECK must allow the row even after deleted_at is set
DROP POLICY IF EXISTS chat_groups_update ON public.chat_groups;
CREATE POLICY chat_groups_update ON public.chat_groups
  FOR UPDATE USING (
    has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    has_active_role(organization_id, array['admin'])
  );
