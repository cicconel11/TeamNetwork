ALTER TABLE public.media_uploads
  ADD COLUMN IF NOT EXISTS preview_file_size bigint;

COMMENT ON COLUMN public.media_uploads.preview_file_size IS
  'Byte size of the derived preview blob stored alongside the original upload';

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS preview_file_size_bytes bigint;

COMMENT ON COLUMN public.media_items.preview_file_size_bytes IS
  'Byte size of the derived preview blob stored alongside the original gallery item';
