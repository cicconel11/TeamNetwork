-- =====================================================
-- Migration: Fix Chat Function Permissions and RLS Policies
-- =====================================================
-- 1. The is_chat_group_member and is_chat_group_moderator functions
--    were missing GRANT EXECUTE permissions.
-- 2. The chat_messages INSERT and SELECT policies required group membership
--    even for org admins, but the app allows org admins to access chats
--    without being explicit members.
-- 3. The has_active_role function was also missing GRANT EXECUTE.
-- 4. The chat_groups UPDATE policy needs to allow soft-deletes (setting deleted_at).

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.is_chat_group_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_group_moderator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_role(uuid, text[]) TO authenticated;

-- =====================================================
-- Fix RLS Policies: chat_groups
-- =====================================================
-- The UPDATE policy needs to allow soft-deletes. The WITH CHECK clause
-- must allow the new row even when deleted_at is set.

DROP POLICY IF EXISTS chat_groups_update ON public.chat_groups;
CREATE POLICY chat_groups_update ON public.chat_groups
  FOR UPDATE USING (
    has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    -- Allow any update by org admin, including soft-deletes
    has_active_role(organization_id, array['admin'])
  );

-- Also need to update SELECT policy to allow admins to see deleted groups
-- (so the update can return the row after soft-delete)
DROP POLICY IF EXISTS chat_groups_select ON public.chat_groups;
CREATE POLICY chat_groups_select ON public.chat_groups
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      -- Admins can see all groups including deleted ones
      has_active_role(organization_id, array['admin'])
      OR (
        -- Non-admins can only see non-deleted groups they're members of
        deleted_at IS NULL
        AND is_chat_group_member(id)
      )
    )
  );

-- =====================================================
-- Fix RLS Policies: chat_messages
-- =====================================================
-- The original policies required is_chat_group_member() for all users,
-- but org admins should be able to read/write messages without being
-- explicit group members.

-- Fix SELECT policy: org admins can see all messages without being members
DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      -- Org admins can see everything
      has_active_role(organization_id, array['admin'])
      OR (
        -- Non-admins must be group members
        is_chat_group_member(chat_group_id)
        AND (
          status = 'approved'
          OR author_id = auth.uid()
          OR is_chat_group_moderator(chat_group_id)
        )
      )
    )
  );

-- Fix INSERT policy: org admins can send messages without being members
DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND author_id = auth.uid()
    AND (
      -- Org admins can send without being members
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(chat_group_id)
    )
  );
