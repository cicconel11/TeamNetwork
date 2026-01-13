-- =====================================================
-- Migration: Fix Chat Group Visibility for Non-Members
-- =====================================================
-- Issue: Users who are not members of a chat group can still see
-- the group on the chat page.
--
-- Root cause: The is_chat_group_member function may return NULL
-- in edge cases, and the RLS policy logic doesn't handle this properly.
-- Additionally, we need to ensure the function is properly secured.
--
-- Fix: 
-- 1. Update is_chat_group_member to use COALESCE to ensure boolean return
-- 2. Simplify the RLS policy logic for clarity
-- 3. Ensure proper function permissions

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
DROP POLICY IF EXISTS chat_groups_select ON public.chat_groups;
CREATE POLICY chat_groups_select ON public.chat_groups
  FOR SELECT USING (
    -- User must be an active org member
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      -- Org admins can see all groups (including soft-deleted for management)
      has_active_role(organization_id, array['admin'])
      OR (
        -- Non-admins can only see non-deleted groups they are explicitly members of
        deleted_at IS NULL
        AND is_chat_group_member(id) = TRUE
      )
    )
  );

-- =====================================================
-- Also fix chat_group_members SELECT policy
-- =====================================================
DROP POLICY IF EXISTS chat_group_members_select ON public.chat_group_members;
CREATE POLICY chat_group_members_select ON public.chat_group_members
  FOR SELECT USING (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      has_active_role(organization_id, array['admin'])
      OR is_chat_group_member(chat_group_id) = TRUE
    )
  );
