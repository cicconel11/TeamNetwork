-- Private bucket for organization media uploads (feed, discussions, jobs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-media',
  'org-media',
  FALSE,
  25 * 1024 * 1024, -- 25MB limit
  ARRAY[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Media upload status tracking
CREATE TYPE public.media_upload_status AS ENUM ('pending', 'ready', 'failed', 'orphaned');
CREATE TYPE public.media_entity_type AS ENUM ('feed_post', 'discussion_thread', 'job_posting');

CREATE TABLE public.media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT,
  entity_type public.media_entity_type,
  entity_id UUID,
  status public.media_upload_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,

  -- Both entity fields must be null or both non-null
  CONSTRAINT media_entity_link_check CHECK (
    (entity_type IS NULL AND entity_id IS NULL) OR
    (entity_type IS NOT NULL AND entity_id IS NOT NULL)
  )
);

-- Index for fetching media by entity (GET routes)
CREATE INDEX idx_media_uploads_entity
  ON public.media_uploads (entity_type, entity_id)
  WHERE status = 'ready' AND deleted_at IS NULL;

-- Index for listing org media
CREATE INDEX idx_media_uploads_org
  ON public.media_uploads (organization_id, status, deleted_at);

-- Index for orphan cleanup cron
CREATE INDEX idx_media_uploads_pending_cleanup
  ON public.media_uploads (status, created_at)
  WHERE status = 'pending';

-- RLS policies
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

-- Org members can read media in their orgs
CREATE POLICY "Org members can view media"
  ON public.media_uploads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = media_uploads.organization_id
        AND uor.user_id = auth.uid()
        AND uor.status = 'active'
    )
  );

-- Uploaders can soft-delete their own media
CREATE POLICY "Uploaders can soft-delete own media"
  ON public.media_uploads FOR UPDATE
  USING (uploader_id = auth.uid())
  WITH CHECK (uploader_id = auth.uid());

-- Org admins can soft-delete any media in their org
CREATE POLICY "Admins can soft-delete org media"
  ON public.media_uploads FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_organization_roles uor
      WHERE uor.organization_id = media_uploads.organization_id
        AND uor.user_id = auth.uid()
        AND uor.role = 'admin'
        AND uor.status = 'active'
    )
  );

-- Storage RLS: org members can read files in their org's folder
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Org members can read org media'
  ) THEN
    CREATE POLICY "Org members can read org media"
    ON storage.objects FOR SELECT
    USING (
      bucket_id = 'org-media'
      AND EXISTS (
        SELECT 1 FROM public.user_organization_roles uor
        WHERE uor.organization_id = (string_to_array(name, '/'))[1]::uuid
          AND uor.user_id = auth.uid()
          AND uor.status = 'active'
      )
    );
  END IF;
END$$;
