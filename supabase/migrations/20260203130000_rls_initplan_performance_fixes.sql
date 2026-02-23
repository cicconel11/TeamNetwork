-- =====================================================
-- Migration: Fix RLS InitPlan Performance Issues
-- Date: 2026-02-03
-- Issues: auth_rls_initplan, multiple_permissive_policies
-- =====================================================
--
-- Wraps auth.uid() and auth.role() in (select ...) to prevent
-- per-row re-evaluation in RLS policies.
--
-- See: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
-- =====================================================

BEGIN;

-- =====================================================
-- Part 1: Fix user_deletion_requests
-- =====================================================

DROP POLICY IF EXISTS "Users can view own deletion request" ON public.user_deletion_requests;
CREATE POLICY "Users can view own deletion request" ON public.user_deletion_requests
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =====================================================
-- Part 2: Fix calendar_feeds (4 policies)
-- =====================================================

DROP POLICY IF EXISTS calendar_feeds_select ON public.calendar_feeds;
CREATE POLICY calendar_feeds_select ON public.calendar_feeds
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS calendar_feeds_insert ON public.calendar_feeds;
CREATE POLICY calendar_feeds_insert ON public.calendar_feeds
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS calendar_feeds_update ON public.calendar_feeds;
CREATE POLICY calendar_feeds_update ON public.calendar_feeds
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS calendar_feeds_delete ON public.calendar_feeds;
CREATE POLICY calendar_feeds_delete ON public.calendar_feeds
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- =====================================================
-- Part 3: Fix calendar_events
-- =====================================================

DROP POLICY IF EXISTS calendar_events_select ON public.calendar_events;
CREATE POLICY calendar_events_select ON public.calendar_events
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- =====================================================
-- Part 4: Fix dev_admin_audit_logs
-- =====================================================

DROP POLICY IF EXISTS dev_admin_audit_logs_service_write ON public.dev_admin_audit_logs;
CREATE POLICY dev_admin_audit_logs_service_write ON public.dev_admin_audit_logs
  FOR ALL
  USING ((SELECT auth.role()) = 'service_role');

-- =====================================================
-- Part 5: Fix chat_groups
-- =====================================================

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
        AND created_by = (SELECT auth.uid())
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
-- Part 6: Fix chat_group_members
-- =====================================================

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
            AND cg.created_by = (SELECT auth.uid())
            AND cg.deleted_at IS NULL
        )
        AND has_active_role(organization_id, array['admin'])
      )
    )
  );

DROP POLICY IF EXISTS chat_group_members_delete ON public.chat_group_members;
CREATE POLICY chat_group_members_delete ON public.chat_group_members
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
    OR user_id = (SELECT auth.uid())
  );

-- =====================================================
-- Part 7: Fix chat_messages (4 policies)
-- =====================================================

DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND (
      status = 'approved'
      OR author_id = (SELECT auth.uid())
      OR is_chat_group_moderator(chat_group_id) = TRUE
      OR has_active_role(organization_id, array['admin'])
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT WITH CHECK (
    has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND is_chat_group_member(chat_group_id) = TRUE
    AND author_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
    AND (
      is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, array['admin'])
      OR author_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS chat_messages_delete ON public.chat_messages;
CREATE POLICY chat_messages_delete ON public.chat_messages
  FOR DELETE USING (
    has_active_role(organization_id, array['admin'])
    OR is_chat_group_moderator(chat_group_id)
    OR author_id = (SELECT auth.uid())
  );

-- =====================================================
-- Part 8: Consolidate event_rsvps UPDATE policies
-- =====================================================
-- Combines event_rsvps_update (user can update own) and
-- event_rsvps_admin_update (admin can update any) into one policy.

DROP POLICY IF EXISTS event_rsvps_admin_update ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_update ON public.event_rsvps;

CREATE POLICY event_rsvps_update ON public.event_rsvps
  FOR UPDATE
  TO authenticated
  USING (
    ((SELECT auth.uid()) = user_id)
    OR is_org_admin(organization_id)
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id)
    OR is_org_admin(organization_id)
  );

COMMIT;
