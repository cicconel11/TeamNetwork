-- Migration: Wrap bare auth.uid() calls in RLS policies with (select auth.uid())
-- This converts volatile per-row evaluation into an initplan evaluated once per query.
-- Impact: 10-100x improvement on large table scans behind RLS.

-- ============================================================
-- ai_messages
-- ============================================================

ALTER POLICY "Users can insert own messages" ON ai_messages
  WITH CHECK (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );

ALTER POLICY "Users can select own messages" ON ai_messages
  USING (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );

ALTER POLICY "Users can update own messages" ON ai_messages
  USING (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  )
  WITH CHECK (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );

-- ============================================================
-- ai_threads
-- ============================================================

ALTER POLICY "Users can insert own threads" ON ai_threads
  WITH CHECK (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM user_organization_roles
      WHERE user_organization_roles.user_id = (select auth.uid())
        AND user_organization_roles.organization_id = ai_threads.org_id
        AND ai_threads.deleted_at IS NULL
    )
  );

ALTER POLICY "Users can select own threads" ON ai_threads
  USING (
    (user_id = (select auth.uid()))
    AND deleted_at IS NULL
  );

ALTER POLICY "Users can update own threads" ON ai_threads
  USING (
    user_id = (select auth.uid())
  )
  WITH CHECK (
    (user_id = (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM user_organization_roles
      WHERE user_organization_roles.user_id = (select auth.uid())
        AND user_organization_roles.organization_id = ai_threads.org_id
        AND ai_threads.deleted_at IS NULL
    )
  );

-- ============================================================
-- alumni_external_ids
-- ============================================================

ALTER POLICY "alumni_external_ids_select_org_member" ON alumni_external_ids
  USING (
    EXISTS (
      SELECT 1
      FROM org_integrations i
      JOIN user_organization_roles r ON r.organization_id = i.organization_id
      WHERE i.id = alumni_external_ids.integration_id
        AND r.user_id = (select auth.uid())
        AND r.status = 'active'::membership_status
    )
  );

-- ============================================================
-- calendar_events
-- ============================================================

ALTER POLICY "calendar_events_select" ON calendar_events
  USING (
    ((select auth.uid()) = user_id)
    OR (scope = 'org' AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']))
    OR (scope = 'personal' AND has_active_role(organization_id, ARRAY['admin']))
  );

-- ============================================================
-- calendar_feeds
-- ============================================================

ALTER POLICY "calendar_feeds_select" ON calendar_feeds
  USING (
    (scope = 'personal' AND (select auth.uid()) = user_id)
    OR (scope = 'org' AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']))
  );

-- ============================================================
-- chat_group_members
-- ============================================================

ALTER POLICY "chat_group_members_update" ON chat_group_members
  USING (
    has_active_role(organization_id, ARRAY['admin'])
    OR is_chat_group_moderator(chat_group_id) = true
    OR is_chat_group_creator(chat_group_id) = true
    OR user_id = (select auth.uid())
  );

-- ============================================================
-- chat_messages
-- ============================================================

ALTER POLICY "chat_messages_insert" ON chat_messages
  WITH CHECK (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
    AND author_id = (select auth.uid())
    AND (has_active_role(organization_id, ARRAY['admin']) OR is_chat_group_member(chat_group_id))
  );

ALTER POLICY "chat_messages_select" ON chat_messages
  USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR (
        is_chat_group_member(chat_group_id)
        AND (
          status = 'approved'::chat_message_status
          OR author_id = (select auth.uid())
          OR is_chat_group_moderator(chat_group_id)
        )
      )
    )
  );

-- ============================================================
-- discussion_replies
-- ============================================================

ALTER POLICY "discussion_replies_delete" ON discussion_replies
  USING (
    (author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NOT NULL
  );

ALTER POLICY "discussion_replies_insert" ON discussion_replies
  WITH CHECK (
    author_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
  );

ALTER POLICY "discussion_replies_update" ON discussion_replies
  USING (
    author_id = (select auth.uid())
  )
  WITH CHECK (
    author_id = (select auth.uid())
  );

ALTER POLICY "Members can create replies" ON discussion_replies
  WITH CHECK (
    (select auth.uid()) = author_id
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
  );

-- ============================================================
-- discussion_threads
-- ============================================================

ALTER POLICY "discussion_threads_delete" ON discussion_threads
  USING (
    (author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NOT NULL
  );

ALTER POLICY "discussion_threads_insert" ON discussion_threads
  WITH CHECK (
    author_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
  );

ALTER POLICY "discussion_threads_update" ON discussion_threads
  USING (
    author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin'])
  )
  WITH CHECK (
    author_id = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin'])
  );

ALTER POLICY "Members can create threads" ON discussion_threads
  WITH CHECK (
    (select auth.uid()) = author_id
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni'])
  );

-- ============================================================
-- event_rsvps
-- ============================================================

ALTER POLICY "event_rsvps_insert" ON event_rsvps
  WITH CHECK (
    (select auth.uid()) = user_id
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

ALTER POLICY "event_rsvps_update" ON event_rsvps
  USING (
    (select auth.uid()) = user_id
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  )
  WITH CHECK (
    (select auth.uid()) = user_id
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

-- ============================================================
-- feed_poll_votes
-- ============================================================

ALTER POLICY "Members can cast votes" ON feed_poll_votes
  WITH CHECK (
    (select auth.uid()) = user_id
    AND is_org_member(organization_id)
  );

ALTER POLICY "Users can update own votes" ON feed_poll_votes
  USING (
    (select auth.uid()) = user_id
  )
  WITH CHECK (
    (select auth.uid()) = user_id
  );

ALTER POLICY "Users can delete own votes" ON feed_poll_votes
  USING (
    (select auth.uid()) = user_id
  );

-- ============================================================
-- job_postings
-- ============================================================

ALTER POLICY "job_postings_delete" ON job_postings
  USING (
    (posted_by = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (posted_by = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin']))
    AND deleted_at IS NOT NULL
  );

ALTER POLICY "job_postings_insert" ON job_postings
  WITH CHECK (
    posted_by = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['admin','alumni'])
  );

ALTER POLICY "job_postings_update" ON job_postings
  USING (
    posted_by = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin'])
  )
  WITH CHECK (
    posted_by = (select auth.uid()) OR has_active_role(organization_id, ARRAY['admin'])
  );

-- ============================================================
-- linkedin_connections
-- ============================================================

ALTER POLICY "users can insert own linkedin connection" ON linkedin_connections
  WITH CHECK (
    (select auth.uid()) = user_id
  );

ALTER POLICY "users can read own linkedin connection" ON linkedin_connections
  USING (
    (select auth.uid()) = user_id
  );

ALTER POLICY "users can update own linkedin connection" ON linkedin_connections
  USING (
    (select auth.uid()) = user_id
  )
  WITH CHECK (
    (select auth.uid()) = user_id
  );

-- ============================================================
-- mentor_profiles
-- ============================================================

ALTER POLICY "mentor_profiles_delete" ON mentor_profiles
  USING (
    user_id = (select auth.uid())
  );

ALTER POLICY "mentor_profiles_insert" ON mentor_profiles
  WITH CHECK (
    user_id = (select auth.uid())
    AND has_active_role(organization_id, ARRAY['alumni'])
  );

ALTER POLICY "mentor_profiles_update" ON mentor_profiles
  USING (
    user_id = (select auth.uid())
  )
  WITH CHECK (
    user_id = (select auth.uid())
  );

-- ============================================================
-- mentorship_pairs
-- ============================================================

ALTER POLICY "mentorship_pairs_select" ON mentorship_pairs
  USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR mentor_user_id = (select auth.uid())
      OR mentee_user_id = (select auth.uid())
    )
  );

-- ============================================================
-- org_integrations
-- ============================================================

ALTER POLICY "org_integrations_select_org_member" ON org_integrations
  USING (
    EXISTS (
      SELECT 1 FROM user_organization_roles r
      WHERE r.organization_id = org_integrations.organization_id
        AND r.user_id = (select auth.uid())
        AND r.status = 'active'::membership_status
    )
  );

-- ============================================================
-- parents
-- ============================================================

ALTER POLICY "parents_update" ON parents
  USING (
    is_org_admin(organization_id)
    OR (user_id IS NOT NULL AND user_id = (select auth.uid()))
  );

-- ============================================================
-- user_linkedin_connections
-- ============================================================

ALTER POLICY "user_linkedin_connections_delete" ON user_linkedin_connections
  USING (
    (select auth.uid()) = user_id
  );

ALTER POLICY "user_linkedin_connections_insert" ON user_linkedin_connections
  WITH CHECK (
    (select auth.uid()) = user_id
  );

ALTER POLICY "user_linkedin_connections_select" ON user_linkedin_connections
  USING (
    (select auth.uid()) = user_id
  );

ALTER POLICY "user_linkedin_connections_update" ON user_linkedin_connections
  USING (
    (select auth.uid()) = user_id
  )
  WITH CHECK (
    (select auth.uid()) = user_id
  );

-- ============================================================
-- user_organization_roles (HIGHEST IMPACT - evaluated on every request)
-- ============================================================

ALTER POLICY "user_org_roles_select" ON user_organization_roles
  USING (
    user_id = (select auth.uid())
    OR has_active_role(organization_id, ARRAY['admin'])
    OR (status = 'active'::membership_status AND has_active_role(organization_id, ARRAY['active_member','alumni','parent']))
  );
