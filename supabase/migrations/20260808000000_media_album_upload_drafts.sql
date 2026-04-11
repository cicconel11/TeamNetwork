ALTER TABLE public.media_albums
  ADD COLUMN IF NOT EXISTS is_upload_draft boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.media_albums.is_upload_draft IS
  'Marks provisional folder-upload albums that should stay hidden until at least one media item is attached.';

CREATE INDEX IF NOT EXISTS idx_media_albums_draft_cleanup
  ON public.media_albums (is_upload_draft, item_count, created_at)
  WHERE deleted_at IS NULL;
