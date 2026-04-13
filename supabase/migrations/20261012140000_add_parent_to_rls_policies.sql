-- Migration: Add 'parent' role to RLS policies
-- Parents should have the same access as active_member for viewing and
-- participating in org features (chat, discussions, announcements, etc.)
-- Skipped: expenses (financial), alumni_update, chat_group_members_insert
-- (admin-only group management), mentorship_logs_update, user_org_roles_update

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- ANNOUNCEMENTS
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS announcements_select ON announcements;
CREATE POLICY announcements_select ON announcements
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- ═══════════════════════════════════════════════════════════════════
-- CHAT GROUP MEMBERS — SELECT only (insert stays admin/mod/creator)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS chat_group_members_select ON chat_group_members;
CREATE POLICY chat_group_members_select ON chat_group_members
  FOR SELECT TO public
  USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      ((removed_at IS NULL) AND (is_chat_group_member(chat_group_id) = true))
      OR has_active_role(organization_id, ARRAY['admin'])
      OR (is_chat_group_moderator(chat_group_id) = true)
      OR (is_chat_group_creator(chat_group_id) = true)
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- CHAT MESSAGES — SELECT, INSERT, UPDATE
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT TO public
  USING (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR (
        is_chat_group_member(chat_group_id)
        AND (
          (status = 'approved'::chat_message_status)
          OR (author_id = (SELECT auth.uid()))
          OR is_chat_group_moderator(chat_group_id)
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_insert ON chat_messages
  FOR INSERT TO public
  WITH CHECK (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (author_id = (SELECT auth.uid()))
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR is_chat_group_member(chat_group_id)
    )
  );

DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
CREATE POLICY chat_messages_update ON chat_messages
  FOR UPDATE TO public
  USING (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      is_chat_group_moderator(chat_group_id)
      OR has_active_role(organization_id, ARRAY['admin'])
      OR (author_id = (SELECT auth.uid()))
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- DISCUSSION THREADS — SELECT (x2), INSERT (x2)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can view threads" ON discussion_threads;
CREATE POLICY "Members can view threads" ON discussion_threads
  FOR SELECT TO public
  USING (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS discussion_threads_select ON discussion_threads;
CREATE POLICY discussion_threads_select ON discussion_threads
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS "Members can create threads" ON discussion_threads;
CREATE POLICY "Members can create threads" ON discussion_threads
  FOR INSERT TO public
  WITH CHECK (
    ((SELECT auth.uid()) = author_id)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS discussion_threads_insert ON discussion_threads;
CREATE POLICY discussion_threads_insert ON discussion_threads
  FOR INSERT TO public
  WITH CHECK (
    (author_id = (SELECT auth.uid()))
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

-- ═══════════════════════════════════════════════════════════════════
-- DISCUSSION REPLIES — SELECT (x2), INSERT (x2)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can view replies" ON discussion_replies;
CREATE POLICY "Members can view replies" ON discussion_replies
  FOR SELECT TO public
  USING (
    (deleted_at IS NULL)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS discussion_replies_select ON discussion_replies;
CREATE POLICY discussion_replies_select ON discussion_replies
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS "Members can create replies" ON discussion_replies;
CREATE POLICY "Members can create replies" ON discussion_replies
  FOR INSERT TO public
  WITH CHECK (
    ((SELECT auth.uid()) = author_id)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS discussion_replies_insert ON discussion_replies;
CREATE POLICY discussion_replies_insert ON discussion_replies
  FOR INSERT TO public
  WITH CHECK (
    (author_id = auth.uid())
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (EXISTS (
      SELECT 1 FROM discussion_threads
      WHERE discussion_threads.id = discussion_replies.thread_id
        AND discussion_threads.organization_id = discussion_replies.organization_id
        AND discussion_threads.deleted_at IS NULL
        AND discussion_threads.is_locked = false
    ))
  );

-- ═══════════════════════════════════════════════════════════════════
-- MEMBERS — UPDATE (self-edit for parents)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS members_update ON members;
CREATE POLICY members_update ON members
  FOR UPDATE TO public
  USING (
    is_org_admin(organization_id)
    OR (
      (user_id = (SELECT auth.uid()))
      AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    )
  )
  WITH CHECK (
    is_org_admin(organization_id)
    OR (
      (user_id = (SELECT auth.uid()))
      AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- JOB POSTINGS — SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS job_postings_select ON job_postings;
CREATE POLICY job_postings_select ON job_postings
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- ═══════════════════════════════════════════════════════════════════
-- MEDIA — albums, items, album_items SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS media_albums_select ON media_albums;
CREATE POLICY media_albums_select ON media_albums
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS media_album_items_select ON media_album_items;
CREATE POLICY media_album_items_select ON media_album_items
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM media_albums a
      WHERE a.id = media_album_items.album_id
        AND has_active_role(a.organization_id, ARRAY['admin','active_member','alumni','parent'])
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- MENTOR PROFILES — SELECT (x2)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Members can view active mentors" ON mentor_profiles;
CREATE POLICY "Members can view active mentors" ON mentor_profiles
  FOR SELECT TO public
  USING (
    (is_active = true)
    AND has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
  );

DROP POLICY IF EXISTS mentor_profiles_select ON mentor_profiles;
CREATE POLICY mentor_profiles_select ON mentor_profiles
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- ═══════════════════════════════════════════════════════════════════
-- MENTORSHIP LOGS — SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS mentorship_logs_select ON mentorship_logs;
CREATE POLICY mentorship_logs_select ON mentorship_logs
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM mentorship_pairs mp
      WHERE mp.id = mentorship_logs.pair_id
        AND mp.organization_id = mentorship_logs.organization_id
        AND has_active_role(mp.organization_id, ARRAY['admin','active_member','alumni','parent'])
        AND (
          has_active_role(mp.organization_id, ARRAY['admin'])
          OR mp.mentor_user_id = (SELECT auth.uid())
          OR mp.mentee_user_id = (SELECT auth.uid())
        )
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- COMPETITION — points + teams SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS competition_points_select ON competition_points;
CREATE POLICY competition_points_select ON competition_points
  FOR SELECT TO public
  USING (
    has_active_role(
      COALESCE(organization_id, (SELECT c.organization_id FROM competitions c WHERE c.id = competition_points.competition_id)),
      ARRAY['admin','active_member','alumni','parent']
    )
  );

DROP POLICY IF EXISTS competition_teams_select ON competition_teams;
CREATE POLICY competition_teams_select ON competition_teams
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- ═══════════════════════════════════════════════════════════════════
-- DONATIONS — org embeds, philanthropy embeds, stats, donations SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS org_donation_embeds_select ON org_donation_embeds;
CREATE POLICY org_donation_embeds_select ON org_donation_embeds
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS org_philanthropy_embeds_select ON org_philanthropy_embeds;
CREATE POLICY org_philanthropy_embeds_select ON org_philanthropy_embeds
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

DROP POLICY IF EXISTS organization_donation_stats_select ON organization_donation_stats;
CREATE POLICY organization_donation_stats_select ON organization_donation_stats
  FOR SELECT TO public
  USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    OR can_edit_page(organization_id, '/donations')
  );

DROP POLICY IF EXISTS organization_donations_select ON organization_donations;
CREATE POLICY organization_donations_select ON organization_donations
  FOR SELECT TO public
  USING (has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent']));

-- ═══════════════════════════════════════════════════════════════════
-- WORKOUT LOGS — SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS workout_logs_select ON workout_logs;
CREATE POLICY workout_logs_select ON workout_logs
  FOR SELECT TO public
  USING (
    has_active_role(organization_id, ARRAY['admin','active_member','alumni','parent'])
    AND (
      has_active_role(organization_id, ARRAY['admin'])
      OR (user_id = (SELECT auth.uid()))
    )
  );

COMMIT;
