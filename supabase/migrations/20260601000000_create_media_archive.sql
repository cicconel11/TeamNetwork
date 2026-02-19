-- Create tables for media archive feature
-- Migration: 20260601000000_create_media_archive.sql

-- =============================================================================
-- 1. media_items table
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  storage_path text,
  external_url text,
  thumbnail_url text,
  file_size_bytes bigint,
  mime_type text,
  width integer,
  height integer,
  duration_seconds integer,
  taken_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'all'
    CHECK (visibility IN ('all', 'members_only', 'admin_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT media_items_source_check CHECK (
    (storage_path IS NOT NULL AND external_url IS NULL)
    OR (storage_path IS NULL AND external_url IS NOT NULL)
  )
);

COMMENT ON TABLE public.media_items IS 'Media archive items (photos and videos) for organizations';
COMMENT ON COLUMN public.media_items.media_type IS 'Type of media: image or video';
COMMENT ON COLUMN public.media_items.storage_path IS 'Path in media-archive storage bucket (XOR with external_url)';
COMMENT ON COLUMN public.media_items.external_url IS 'External URL for media (XOR with storage_path)';
COMMENT ON COLUMN public.media_items.thumbnail_url IS 'Optional thumbnail URL (server-generated in v2)';
COMMENT ON COLUMN public.media_items.tags IS 'Array of tags for filtering (max 20 enforced in app)';
COMMENT ON COLUMN public.media_items.visibility IS 'Visibility level: all, members_only, admin_only';
COMMENT ON COLUMN public.media_items.taken_at IS 'When the photo/video was originally taken';

-- Main gallery listing (org + soft-delete + newest first)
CREATE INDEX idx_media_items_listing
  ON public.media_items (organization_id, deleted_at, created_at DESC);

-- Tag filtering (GIN on array)
CREATE INDEX idx_media_items_tags
  ON public.media_items USING GIN (tags);

-- Date-based browsing ("photos from 2024")
CREATE INDEX idx_media_items_taken_at
  ON public.media_items (organization_id, taken_at DESC)
  WHERE deleted_at IS NULL;

-- Media type filtering
CREATE INDEX idx_media_items_type
  ON public.media_items (organization_id, media_type, deleted_at);

-- Enable RLS
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for media_items
CREATE POLICY "media_items_select" ON public.media_items
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "media_items_insert" ON public.media_items
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "media_items_update" ON public.media_items
  FOR UPDATE USING (
    uploaded_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  );

CREATE POLICY "media_items_delete" ON public.media_items
  FOR UPDATE USING (
    (uploaded_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (uploaded_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- updated_at trigger
CREATE TRIGGER media_items_updated_at
  BEFORE UPDATE ON public.media_items FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. media_albums table (v1.5 — schema only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_albums (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  cover_media_id uuid REFERENCES public.media_items(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

COMMENT ON TABLE public.media_albums IS 'Albums for grouping media items (v1.5 feature)';
COMMENT ON COLUMN public.media_albums.item_count IS 'Cached count of items in album';

CREATE INDEX idx_media_albums_listing
  ON public.media_albums (organization_id, deleted_at, created_at DESC);

-- Enable RLS
ALTER TABLE public.media_albums ENABLE ROW LEVEL SECURITY;

-- RLS Policies for media_albums
CREATE POLICY "media_albums_select" ON public.media_albums
  FOR SELECT USING (
    has_active_role(organization_id, array['admin','active_member','alumni'])
  );

CREATE POLICY "media_albums_insert" ON public.media_albums
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND has_active_role(organization_id, array['admin','active_member'])
  );

CREATE POLICY "media_albums_update" ON public.media_albums
  FOR UPDATE USING (
    created_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    created_by = auth.uid()
    OR has_active_role(organization_id, array['admin'])
  );

CREATE POLICY "media_albums_delete" ON public.media_albums
  FOR UPDATE USING (
    (created_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NULL
  )
  WITH CHECK (
    (created_by = auth.uid() OR has_active_role(organization_id, array['admin']))
    AND deleted_at IS NOT NULL
  );

-- updated_at trigger
CREATE TRIGGER media_albums_updated_at
  BEFORE UPDATE ON public.media_albums FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 3. media_album_items junction table (v1.5)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_album_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  album_id uuid NOT NULL REFERENCES public.media_albums(id) ON DELETE CASCADE,
  media_item_id uuid NOT NULL REFERENCES public.media_items(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(album_id, media_item_id)
);

COMMENT ON TABLE public.media_album_items IS 'Junction table linking media items to albums';

CREATE INDEX idx_media_album_items_album
  ON public.media_album_items (album_id, sort_order);

-- Enable RLS
ALTER TABLE public.media_album_items ENABLE ROW LEVEL SECURITY;

-- RLS: inherit access from album
CREATE POLICY "media_album_items_select" ON public.media_album_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.media_albums a
      WHERE a.id = album_id
      AND has_active_role(a.organization_id, array['admin','active_member','alumni'])
    )
  );

CREATE POLICY "media_album_items_insert" ON public.media_album_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.media_albums a
      WHERE a.id = album_id
      AND (a.created_by = auth.uid() OR has_active_role(a.organization_id, array['admin']))
    )
  );

CREATE POLICY "media_album_items_delete" ON public.media_album_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.media_albums a
      WHERE a.id = album_id
      AND (a.created_by = auth.uid() OR has_active_role(a.organization_id, array['admin']))
    )
  );

-- =============================================================================
-- 4. Storage bucket
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-archive', 'media-archive', TRUE,
  52428800,  -- 50MB safety net
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif',
        'video/mp4','video/quicktime','video/webm']
) ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- =============================================================================
-- 5. Upload permissions column on organizations
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS media_upload_roles text[] NOT NULL DEFAULT ARRAY['admin'];
