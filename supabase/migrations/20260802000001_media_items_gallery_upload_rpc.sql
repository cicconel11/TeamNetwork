CREATE OR REPLACE FUNCTION public.create_media_gallery_upload(
  p_org_id uuid,
  p_uploaded_by uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_media_type text,
  p_title text,
  p_description text DEFAULT NULL,
  p_tags text[] DEFAULT ARRAY[]::text[],
  p_taken_at timestamptz DEFAULT NULL,
  p_status text DEFAULT 'uploading'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_media_id uuid;
BEGIN
  UPDATE public.media_items
  SET gallery_sort_order = gallery_sort_order + 1,
      updated_at = now()
  WHERE organization_id = p_org_id AND deleted_at IS NULL;

  INSERT INTO public.media_items (
    organization_id,
    uploaded_by,
    storage_path,
    file_name,
    mime_type,
    file_size_bytes,
    media_type,
    title,
    description,
    tags,
    taken_at,
    status,
    gallery_sort_order
  )
  VALUES (
    p_org_id,
    p_uploaded_by,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_file_size_bytes,
    p_media_type,
    p_title,
    p_description,
    COALESCE(p_tags, ARRAY[]::text[]),
    p_taken_at,
    p_status,
    0
  )
  RETURNING id INTO v_media_id;

  RETURN v_media_id;
END;
$$;

ALTER FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) TO service_role;
