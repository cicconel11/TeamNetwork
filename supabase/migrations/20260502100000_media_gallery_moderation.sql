-- =============================================================================
-- Media Gallery Moderation Support
-- Adds moderation workflow (status enum), reviewed_by/reviewed_at,
-- file_name column, org-media private bucket, and status-aware RLS policies.
-- =============================================================================

-- 1. Create media_status enum
CREATE TYPE public.media_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. Add moderation columns to existing media_items table
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS status public.media_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_name text;

-- 3. Indexes for moderation
-- Gallery listing index (org + soft-delete + status + newest first)
CREATE INDEX IF NOT EXISTS idx_media_items_gallery_listing
  ON public.media_items (organization_id, deleted_at, status, created_at DESC);

-- Moderation queue index (pending items only)
CREATE INDEX IF NOT EXISTS idx_media_items_moderation_queue
  ON public.media_items (organization_id, status, deleted_at, created_at)
  WHERE status = 'pending' AND deleted_at IS NULL;

-- User's uploads index
CREATE INDEX IF NOT EXISTS idx_media_items_uploader
  ON public.media_items (uploaded_by, organization_id, deleted_at);

-- 4. Drop existing generic SELECT policy and replace with status-aware policies
DROP POLICY IF EXISTS "media_items_select" ON public.media_items;

-- 4a. All org members can see approved, non-deleted items
CREATE POLICY "media_items_select_approved" ON public.media_items
  FOR SELECT USING (
    deleted_at IS NULL
    AND status = 'approved'
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

-- 4b. Admins can see all statuses (pending, approved, rejected) for moderation
CREATE POLICY "media_items_select_admin" ON public.media_items
  FOR SELECT USING (
    deleted_at IS NULL
    AND has_active_role(organization_id, array['admin'])
  );

-- 4c. Uploaders can always see their own items (any status)
CREATE POLICY "media_items_select_own" ON public.media_items
  FOR SELECT USING (
    deleted_at IS NULL
    AND uploaded_by = auth.uid()
  );

-- 5. Create org-media private bucket for gallery uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-media', 'org-media', FALSE,
  20971520,  -- 20MB
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif',
        'video/mp4','video/quicktime','video/webm']
) ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
