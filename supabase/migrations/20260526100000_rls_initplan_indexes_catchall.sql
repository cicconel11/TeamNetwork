-- =====================================================
-- Migration: Comprehensive RLS InitPlan + FK Index Fixes
-- Date: 2026-05-26
-- Purpose: Catch-all for performance and security fixes:
--   1. Rewrite remaining policies to use (select auth.uid()) initplan pattern
--   2. Add service-role-only policies to 8 unprotected tables
--   3. Add missing FK indexes on 7 tables
--   4. Drop duplicate enterprises_slug_idx
--   5. Fix update_thread_activity search_path
-- =====================================================

BEGIN;

-- =====================================================
-- Part 1: InitPlan fixes for analytics_consent (3 policies)
-- Created by main-branch migration with bare auth.uid()
-- =====================================================

DROP POLICY IF EXISTS analytics_consent_select ON public.analytics_consent;
CREATE POLICY analytics_consent_select ON public.analytics_consent
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_organization_roles uor
      WHERE uor.organization_id = analytics_consent.org_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
    )
  );

DROP POLICY IF EXISTS analytics_consent_update ON public.analytics_consent;
CREATE POLICY analytics_consent_update ON public.analytics_consent
  FOR UPDATE
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_organization_roles uor
      WHERE uor.organization_id = analytics_consent.org_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_organization_roles uor
      WHERE uor.organization_id = analytics_consent.org_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
    )
  );

DROP POLICY IF EXISTS analytics_consent_upsert ON public.analytics_consent;
CREATE POLICY analytics_consent_upsert ON public.analytics_consent
  FOR INSERT
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_organization_roles uor
      WHERE uor.organization_id = analytics_consent.org_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
    )
  );

-- =====================================================
-- Part 2: InitPlan fix for ui_profiles
-- =====================================================

DROP POLICY IF EXISTS "Users can read own ui profile" ON public.ui_profiles;
CREATE POLICY "Users can read own ui profile" ON public.ui_profiles
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

-- =====================================================
-- Part 3: InitPlan fixes for organizations (insert + select_member)
-- organizations_select uses TRUE (no auth call), organizations_update uses helper
-- =====================================================

DROP POLICY IF EXISTS organizations_insert ON public.organizations;
CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS organizations_select_member ON public.organizations;
CREATE POLICY organizations_select_member ON public.organizations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_organization_roles uor
      WHERE uor.organization_id = organizations.id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status IN ('active', 'pending')
    )
  );

-- =====================================================
-- Part 4: InitPlan fix for user_enterprise_roles select_own
-- =====================================================

DROP POLICY IF EXISTS user_enterprise_roles_select_own ON public.user_enterprise_roles;
CREATE POLICY user_enterprise_roles_select_own ON public.user_enterprise_roles
  FOR SELECT USING (user_id = (SELECT auth.uid()));

-- =====================================================
-- Part 5: Service-role-only policies on 8 previously unprotected tables
-- These tables had RLS enabled but no policies, making them inaccessible.
-- They are written only by service role (cron jobs, API routes).
-- =====================================================

ALTER TABLE IF EXISTS public.analytics_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.analytics_events;
CREATE POLICY service_role_only ON public.analytics_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.analytics_ops_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.analytics_ops_events;
CREATE POLICY service_role_only ON public.analytics_ops_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.ops_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.ops_events;
CREATE POLICY service_role_only ON public.ops_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.rate_limit_analytics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.rate_limit_analytics;
CREATE POLICY service_role_only ON public.rate_limit_analytics
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.schedule_allowed_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.schedule_allowed_domains;
CREATE POLICY service_role_only ON public.schedule_allowed_domains
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.schedule_domain_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.schedule_domain_rules;
CREATE POLICY service_role_only ON public.schedule_domain_rules
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.usage_events;
CREATE POLICY service_role_only ON public.usage_events
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

ALTER TABLE IF EXISTS public.usage_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_only ON public.usage_summaries;
CREATE POLICY service_role_only ON public.usage_summaries
  FOR ALL USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- =====================================================
-- Part 5b: Recreate chat helper functions with initplan pattern
-- These are last created by main-branch migration 20260429100000
-- with bare auth.uid() — need initplan fix
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
       AND cgm.user_id = (select auth.uid())
       AND cgm.removed_at IS NULL
     LIMIT 1),
    FALSE
  );
$$;

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
       AND cgm.user_id = (select auth.uid())
       AND cgm.role IN ('admin', 'moderator')
       AND cgm.removed_at IS NULL
     LIMIT 1),
    FALSE
  );
$$;

-- =====================================================
-- Part 5c: Recreate enterprise_invites_select with initplan
-- =====================================================

DROP POLICY IF EXISTS enterprise_invites_select ON public.enterprise_invites;
CREATE POLICY enterprise_invites_select ON public.enterprise_invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_enterprise_roles
      WHERE user_enterprise_roles.enterprise_id = enterprise_invites.enterprise_id
        AND user_enterprise_roles.user_id = (SELECT auth.uid())
        AND user_enterprise_roles.role IN ('owner', 'org_admin')
    )
  );

-- =====================================================
-- Part 6: Missing FK indexes
-- Speeds up JOIN/DELETE operations on foreign key columns
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_discussion_replies_org_id
  ON public.discussion_replies (organization_id);

CREATE INDEX IF NOT EXISTS idx_feed_comments_author_id
  ON public.feed_comments (author_id);

CREATE INDEX IF NOT EXISTS idx_feed_comments_org_id
  ON public.feed_comments (organization_id);

CREATE INDEX IF NOT EXISTS idx_feed_likes_org_id
  ON public.feed_likes (organization_id);

CREATE INDEX IF NOT EXISTS idx_feed_likes_post
  ON public.feed_likes (post_id);

CREATE INDEX IF NOT EXISTS idx_feed_posts_author_id
  ON public.feed_posts (author_id);

CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id
  ON public.payment_attempts (user_id);

CREATE INDEX IF NOT EXISTS idx_org_donations_event_id
  ON public.organization_donations (event_id);

CREATE INDEX IF NOT EXISTS idx_academic_schedules_user_id
  ON public.academic_schedules (user_id);

-- =====================================================
-- Part 7: Drop duplicate enterprises index
-- enterprises_slug_key (unique constraint) already provides index coverage
-- =====================================================

DROP INDEX IF EXISTS public.enterprises_slug_idx;

-- =====================================================
-- Part 8: Fix update_thread_activity search_path
-- Prevents privilege escalation via search_path injection
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_thread_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE discussion_threads
    SET reply_count = reply_count + 1,
        last_activity_at = now(),
        updated_at = now()
    WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE discussion_threads
    SET reply_count = GREATEST(reply_count - 1, 0),
        updated_at = now()
    WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
