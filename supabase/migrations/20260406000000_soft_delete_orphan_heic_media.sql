-- Soft-delete the one orphaned HEIC media item that has no preview and
-- cannot render in browsers. HEIC uploads are now rejected at the client
-- (src/lib/media/gallery-validation.ts), so this is a one-off cleanup
-- of a row uploaded before that guard landed.
DO $$
BEGIN
  IF to_regclass('public.media_items') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.media_items
  SET deleted_at = now()
  WHERE id = '53a544cc-255b-4801-895a-02d31d4dc162'
    AND organization_id = '64c09315-df95-4579-b1d6-b4f6e7f5378d'
    AND deleted_at IS NULL;
END $$;
