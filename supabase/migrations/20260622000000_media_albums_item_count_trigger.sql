-- =============================================================================
-- Trigger: auto-update media_albums.item_count on insert/delete of album items
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_media_album_item_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.media_albums SET item_count = item_count + 1, updated_at = now()
    WHERE id = NEW.album_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.media_albums SET item_count = GREATEST(0, item_count - 1), updated_at = now()
    WHERE id = OLD.album_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS media_album_items_count ON public.media_album_items;

CREATE TRIGGER media_album_items_count
  AFTER INSERT OR DELETE ON public.media_album_items
  FOR EACH ROW EXECUTE FUNCTION public.update_media_album_item_count();

-- Initialize existing counts (safe to run idempotently)
UPDATE public.media_albums SET item_count = (
  SELECT COUNT(*) FROM public.media_album_items WHERE album_id = media_albums.id
);
