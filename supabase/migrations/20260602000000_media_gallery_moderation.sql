-- Add moderation support to media_items table
-- Migration: 20260602000000_media_gallery_moderation.sql
--
-- NOTE: The 'uploading' enum value must be added in a SEPARATE transaction
-- before this migration runs, because Postgres requires new enum values
-- to be committed before use. See: 20260601100000_media_status_add_uploading.sql

-- =============================================================================
-- 1. Rename reviewed_by/reviewed_at to moderated_by/moderated_at
-- =============================================================================

ALTER TABLE public.media_items
  RENAME COLUMN reviewed_by TO moderated_by;

ALTER TABLE public.media_items
  RENAME COLUMN reviewed_at TO moderated_at;

-- =============================================================================
-- 2. Add rejection_reason column
-- =============================================================================

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Rejection reason required when status is 'rejected'
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_rejection_reason_check
  CHECK (status != 'rejected' OR rejection_reason IS NOT NULL);

-- =============================================================================
-- 3. Update bucket config: increase org-media to 100MB, add HEIC
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-media', 'org-media', FALSE,
  104857600,  -- 100MB
  ARRAY[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 4. Moderation-specific indexes
-- =============================================================================

-- Gallery listing with cursor pagination (status-aware)
CREATE INDEX IF NOT EXISTS idx_media_items_gallery_cursor
  ON public.media_items (organization_id, status, deleted_at, created_at DESC, id DESC);

-- Moderation queue: pending items ordered by upload time
CREATE INDEX IF NOT EXISTS idx_media_items_moderation_queue
  ON public.media_items (organization_id, status, created_at ASC)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- User's own uploads
CREATE INDEX IF NOT EXISTS idx_media_items_user_uploads
  ON public.media_items (uploaded_by, organization_id, deleted_at, created_at DESC);

-- =============================================================================
-- 5. Update RLS policies for moderation-based visibility
-- =============================================================================

-- Drop existing policies so we can recreate with moderation logic
DROP POLICY IF EXISTS "media_items_select" ON public.media_items;
DROP POLICY IF EXISTS "media_items_insert" ON public.media_items;
DROP POLICY IF EXISTS "media_items_update" ON public.media_items;
DROP POLICY IF EXISTS "media_items_delete" ON public.media_items;

-- SELECT: approved items visible to all org members; own items in any status;
-- admins see everything in their org
CREATE POLICY "media_items_select" ON public.media_items
  FOR SELECT USING (
    -- Admins see everything in their org
    has_active_role(organization_id, array['admin'])
    OR (
      -- Non-admins: approved items only, plus own items in any status
      has_active_role(organization_id, array['active_member', 'alumni'])
      AND (status = 'approved' OR uploaded_by = auth.uid())
    )
  );

-- INSERT: org members with active role can insert (API layer checks media_upload_roles)
CREATE POLICY "media_items_insert" ON public.media_items
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
  );

-- UPDATE: uploader can update own uploading/pending items; admins can update any
CREATE POLICY "media_items_update" ON public.media_items
  FOR UPDATE USING (
    (uploaded_by = auth.uid() AND status IN ('uploading', 'pending'))
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    (uploaded_by = auth.uid() AND status IN ('uploading', 'pending'))
    OR has_active_role(organization_id, array['admin'])
  );

-- Soft-delete: uploader or admin can set deleted_at
CREATE POLICY "media_items_soft_delete" ON public.media_items
  FOR UPDATE USING (
    deleted_at IS NULL
    AND (uploaded_by = auth.uid() OR has_active_role(organization_id, array['admin']))
  )
  WITH CHECK (
    deleted_at IS NOT NULL
    AND (uploaded_by = auth.uid() OR has_active_role(organization_id, array['admin']))
  );
