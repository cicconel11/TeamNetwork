-- Manual gallery order for org media grid (0 = first / newest after prepend).

ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS gallery_sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.media_items.gallery_sort_order IS 'Display order in org gallery (0 = first).';

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY created_at DESC) - 1 AS rn
  FROM public.media_items
  WHERE deleted_at IS NULL
)
UPDATE public.media_items m
SET gallery_sort_order = ranked.rn
FROM ranked
WHERE m.id = ranked.id;

CREATE INDEX IF NOT EXISTS idx_media_items_org_gallery_sort
  ON public.media_items (organization_id, gallery_sort_order)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.shift_media_gallery_sort_orders(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.media_items
  SET gallery_sort_order = gallery_sort_order + 1,
      updated_at = now()
  WHERE organization_id = p_org_id AND deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_media_gallery(p_org_id uuid, p_media_ids uuid[])
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
  FROM public.media_items
  WHERE organization_id = p_org_id AND deleted_at IS NULL;

  input_count := COALESCE(array_length(p_media_ids, 1), 0);

  IF expected_count = 0 THEN
    IF input_count = 0 THEN RETURN; END IF;
    RAISE EXCEPTION 'media_count_mismatch';
  END IF;

  IF expected_count != input_count THEN
    RAISE EXCEPTION 'media_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_media_ids) AS u(id)
    GROUP BY id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_media_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_media_ids) AS mid(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.media_items m
      WHERE m.id = mid.id AND m.organization_id = p_org_id AND m.deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'invalid_media_id';
  END IF;

  UPDATE public.media_items m
  SET gallery_sort_order = u.ord - 1,
      updated_at = now()
  FROM unnest(p_media_ids) WITH ORDINALITY AS u(media_id, ord)
  WHERE m.id = u.media_id AND m.organization_id = p_org_id AND m.deleted_at IS NULL;
END;
$$;

ALTER FUNCTION public.shift_media_gallery_sort_orders(uuid) OWNER TO postgres;
ALTER FUNCTION public.reorder_media_gallery(uuid, uuid[]) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.shift_media_gallery_sort_orders(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_media_gallery(uuid, uuid[]) TO service_role;
