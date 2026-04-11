-- Album display order within each organization (0 = first).

ALTER TABLE public.media_albums
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.media_albums.sort_order IS 'Display order per organization (0 = first).';

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at DESC) - 1 AS rn
  FROM public.media_albums
  WHERE deleted_at IS NULL
)
UPDATE public.media_albums m
SET sort_order = ranked.rn
FROM ranked
WHERE m.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_media_albums_org_sort
  ON public.media_albums (organization_id, sort_order)
  WHERE deleted_at IS NULL;

-- Bump existing albums so a new row can be inserted at sort_order = 0 (newest-first).
CREATE OR REPLACE FUNCTION public.shift_media_album_sort_orders(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.media_albums
  SET sort_order = sort_order + 1,
      updated_at = now()
  WHERE organization_id = p_org_id AND deleted_at IS NULL;
END;
$$;

-- Set sort_order from a full permutation of album ids for an org (atomic).
CREATE OR REPLACE FUNCTION public.reorder_media_albums(p_org_id uuid, p_album_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_count int;
  input_count int;
BEGIN
  SELECT COUNT(*)::int INTO expected_count
  FROM public.media_albums
  WHERE organization_id = p_org_id AND deleted_at IS NULL;

  input_count := COALESCE(array_length(p_album_ids, 1), 0);

  IF expected_count = 0 THEN
    IF input_count = 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'album_count_mismatch';
  END IF;

  IF expected_count != input_count THEN
    RAISE EXCEPTION 'album_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_album_ids) AS u(id)
    GROUP BY id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_album_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_album_ids) AS aid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.media_albums m
      WHERE m.id = aid.id AND m.organization_id = p_org_id AND m.deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'invalid_album_id';
  END IF;

  UPDATE public.media_albums m
  SET sort_order = u.ord - 1,
      updated_at = now()
  FROM unnest(p_album_ids) WITH ORDINALITY AS u(album_id, ord)
  WHERE m.id = u.album_id AND m.organization_id = p_org_id AND m.deleted_at IS NULL;
END;
$$;

ALTER FUNCTION public.shift_media_album_sort_orders(uuid) OWNER TO postgres;
ALTER FUNCTION public.reorder_media_albums(uuid, uuid[]) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.shift_media_album_sort_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_media_albums(uuid, uuid[]) TO service_role;
