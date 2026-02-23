-- Migration: RLS Policy Performance Fixes, Consolidation & Missing FK Indexes
--
-- 1. Drop 3 stale media_items SELECT policies (leftover from 20260502)
-- 2. media_items: initplan fix + UPDATE consolidation (closes un-delete bug)
-- 3. media_albums: initplan fix + UPDATE consolidation (closes un-delete bug)
-- 4. media_album_items: initplan fix
-- 5. media_uploads: initplan fix
-- 6. organizations: drop dead-code SELECT policy
-- 7. feed_posts: consolidate UPDATE policies (closes un-delete bug)
-- 8. feed_comments: consolidate UPDATE policies (closes un-delete bug)
-- 9. Add 8 missing FK indexes

BEGIN;

-- ============================================================
-- Section 1: Drop 3 stale media_items SELECT policies
-- These were created in 20260502 but 20260602 forgot to drop them.
-- They coexist with the consolidated media_items_select from 20260602.
-- ============================================================

DROP POLICY IF EXISTS "media_items_select_approved" ON public.media_items;
DROP POLICY IF EXISTS "media_items_select_admin"    ON public.media_items;
DROP POLICY IF EXISTS "media_items_select_own"      ON public.media_items;


-- ============================================================
-- Section 2: media_items — initplan fix + UPDATE consolidation
-- ============================================================

-- SELECT: wrap bare auth.uid() → (SELECT auth.uid())
DROP POLICY IF EXISTS "media_items_select" ON public.media_items;
CREATE POLICY "media_items_select" ON public.media_items
  FOR SELECT USING (
    has_active_role(organization_id, array['admin'])
    OR (
      has_active_role(organization_id, array['active_member', 'alumni'])
      AND (status = 'approved' OR uploaded_by = (SELECT auth.uid()))
    )
  );

-- INSERT: wrap bare auth.uid() → (SELECT auth.uid())
DROP POLICY IF EXISTS "media_items_insert" ON public.media_items;
CREATE POLICY "media_items_insert" ON public.media_items
  FOR INSERT WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
  );

-- UPDATE: merge media_items_update + media_items_soft_delete into one policy.
-- USING gates on deleted_at IS NULL to prevent un-delete.
-- Uploaders: edit own uploading/pending items, or soft-delete own items.
-- Admins: edit/moderate any non-deleted item, or soft-delete any item.
DROP POLICY IF EXISTS "media_items_update" ON public.media_items;
DROP POLICY IF EXISTS "media_items_soft_delete" ON public.media_items;
CREATE POLICY "media_items_update" ON public.media_items
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      uploaded_by = (SELECT auth.uid())
      OR has_active_role(organization_id, array['admin'])
    )
  )
  WITH CHECK (
    -- Uploader: edit own uploading/pending (keep alive) or soft-delete own
    (
      uploaded_by = (SELECT auth.uid())
      AND (
        (status IN ('uploading', 'pending') AND deleted_at IS NULL)
        OR deleted_at IS NOT NULL
      )
    )
    -- Admin: edit or soft-delete any item
    OR has_active_role(organization_id, array['admin'])
  );


-- ============================================================
-- Section 3: media_albums — initplan fix + UPDATE consolidation
-- ============================================================

-- INSERT: wrap bare auth.uid() → (SELECT auth.uid())
DROP POLICY IF EXISTS "media_albums_insert" ON public.media_albums;
CREATE POLICY "media_albums_insert" ON public.media_albums
  FOR INSERT WITH CHECK (
    created_by = (SELECT auth.uid())
    AND has_active_role(organization_id, array['admin', 'active_member'])
  );

-- UPDATE: merge media_albums_update + media_albums_delete into one policy.
-- USING gates on deleted_at IS NULL to prevent un-delete.
DROP POLICY IF EXISTS "media_albums_update" ON public.media_albums;
DROP POLICY IF EXISTS "media_albums_delete" ON public.media_albums;
CREATE POLICY "media_albums_update" ON public.media_albums
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      created_by = (SELECT auth.uid())
      OR has_active_role(organization_id, array['admin'])
    )
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    OR has_active_role(organization_id, array['admin'])
  );


-- ============================================================
-- Section 4: media_album_items — initplan fix
-- ============================================================

-- INSERT: wrap bare auth.uid() in EXISTS → (SELECT auth.uid())
DROP POLICY IF EXISTS "media_album_items_insert" ON public.media_album_items;
CREATE POLICY "media_album_items_insert" ON public.media_album_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.media_albums a
      WHERE a.id = album_id
      AND (a.created_by = (SELECT auth.uid()) OR has_active_role(a.organization_id, array['admin']))
    )
  );

-- DELETE: wrap bare auth.uid() in EXISTS → (SELECT auth.uid())
DROP POLICY IF EXISTS "media_album_items_delete" ON public.media_album_items;
CREATE POLICY "media_album_items_delete" ON public.media_album_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.media_albums a
      WHERE a.id = album_id
      AND (a.created_by = (SELECT auth.uid()) OR has_active_role(a.organization_id, array['admin']))
    )
  );


-- ============================================================
-- Section 5: media_uploads — initplan fix
-- ============================================================

-- SELECT: wrap bare auth.uid() in EXISTS → (SELECT auth.uid())
DROP POLICY IF EXISTS "Org members can view media" ON public.media_uploads;
CREATE POLICY "Org members can view media" ON public.media_uploads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = media_uploads.organization_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
    )
  );

-- UPDATE (uploader soft-delete): wrap bare auth.uid() → (SELECT auth.uid())
DROP POLICY IF EXISTS "Uploaders can soft-delete own media" ON public.media_uploads;
CREATE POLICY "Uploaders can soft-delete own media" ON public.media_uploads
  FOR UPDATE
  USING (uploader_id = (SELECT auth.uid()))
  WITH CHECK (uploader_id = (SELECT auth.uid()));

-- UPDATE (admin soft-delete): wrap bare auth.uid() in EXISTS → (SELECT auth.uid())
DROP POLICY IF EXISTS "Admins can soft-delete org media" ON public.media_uploads;
CREATE POLICY "Admins can soft-delete org media" ON public.media_uploads
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = media_uploads.organization_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.role = 'admin'
        AND uor.status = 'active'
    )
  );


-- ============================================================
-- Section 6: organizations — drop dead-code SELECT policy
-- organizations_select uses USING (true), making this unreachable
-- ============================================================

DROP POLICY IF EXISTS "organizations_select_member" ON public.organizations;


-- ============================================================
-- Section 7: feed_posts — consolidate UPDATE policies
-- Merges feed_posts_update + feed_posts_delete into one policy.
-- Closes un-delete bug by gating USING on deleted_at IS NULL.
-- ============================================================

DROP POLICY IF EXISTS "feed_posts_update" ON public.feed_posts;
DROP POLICY IF EXISTS "feed_posts_delete" ON public.feed_posts;
CREATE POLICY "feed_posts_update" ON public.feed_posts
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      author_id = (SELECT auth.uid())
      OR has_active_role(organization_id, array['admin'])
    )
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    OR has_active_role(organization_id, array['admin'])
  );


-- ============================================================
-- Section 8: feed_comments — consolidate UPDATE policies
-- Merges feed_comments_update + feed_comments_delete into one.
-- Key: admins can soft-delete but NOT edit comment body.
-- ============================================================

DROP POLICY IF EXISTS "feed_comments_update" ON public.feed_comments;
DROP POLICY IF EXISTS "feed_comments_delete" ON public.feed_comments;
CREATE POLICY "feed_comments_update" ON public.feed_comments
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      author_id = (SELECT auth.uid())
      OR has_active_role(organization_id, array['admin'])
    )
  )
  WITH CHECK (
    -- Author: can edit (keep alive) or soft-delete
    author_id = (SELECT auth.uid())
    -- Admin: can only soft-delete (not edit body)
    OR (has_active_role(organization_id, array['admin']) AND deleted_at IS NOT NULL)
  );


-- ============================================================
-- Section 9: Missing FK indexes (8 indexes)
-- ============================================================

-- High priority: large append-only table
CREATE INDEX IF NOT EXISTS idx_ops_events_org_id
  ON public.ops_events (org_id);

-- Medium priority: 2nd col in composite PK, no standalone index
CREATE INDEX IF NOT EXISTS idx_analytics_consent_user_id
  ON public.analytics_consent (user_id);

-- Medium priority: cascade delete path
CREATE INDEX IF NOT EXISTS idx_media_uploads_uploader_id
  ON public.media_uploads (uploader_id);

-- Medium priority: junction table cascade
CREATE INDEX IF NOT EXISTS idx_media_album_items_media_item_id
  ON public.media_album_items (media_item_id);

-- Low priority: SET NULL on delete
CREATE INDEX IF NOT EXISTS idx_media_albums_cover_media_id
  ON public.media_albums (cover_media_id);

-- Low priority: cascade delete
CREATE INDEX IF NOT EXISTS idx_media_albums_created_by
  ON public.media_albums (created_by);

-- Low priority: renamed from reviewed_by in 20260602
CREATE INDEX IF NOT EXISTS idx_media_items_moderated_by
  ON public.media_items (moderated_by);

-- Low priority: purged daily
CREATE INDEX IF NOT EXISTS idx_rate_limit_analytics_org_id
  ON public.rate_limit_analytics (org_id);

COMMIT;
