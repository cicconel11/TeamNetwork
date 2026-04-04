-- The status column is type media_status (enum) but the RPC passes text.
-- Drop both overloads and recreate with p_status::media_status cast.

DROP FUNCTION IF EXISTS public.create_media_gallery_upload(uuid,uuid,text,text,text,bigint,text,text,text,text[],timestamptz,text);
DROP FUNCTION IF EXISTS public.create_media_gallery_upload(uuid,uuid,text,text,text,text,bigint,text,text,text,text[],timestamptz,text);

-- Overload 1: without preview_storage_path (12 params)
CREATE OR REPLACE FUNCTION public.create_media_gallery_upload(
  p_org_id uuid,
  p_uploaded_by uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_media_type text,
  p_title text,
  p_description text DEFAULT NULL::text,
  p_tags text[] DEFAULT ARRAY[]::text[],
  p_taken_at timestamptz DEFAULT NULL::timestamptz,
  p_status text DEFAULT 'uploading'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    p_status::media_status,
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
) FROM PUBLIC, anon, authenticated;

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

-- Overload 2: with preview_storage_path (13 params)
CREATE OR REPLACE FUNCTION public.create_media_gallery_upload(
  p_org_id uuid,
  p_uploaded_by uuid,
  p_storage_path text,
  p_preview_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_media_type text,
  p_title text,
  p_description text DEFAULT NULL::text,
  p_tags text[] DEFAULT ARRAY[]::text[],
  p_taken_at timestamptz DEFAULT NULL::timestamptz,
  p_status text DEFAULT 'uploading'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    preview_storage_path,
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
    p_preview_storage_path,
    p_file_name,
    p_mime_type,
    p_file_size_bytes,
    p_media_type,
    p_title,
    p_description,
    COALESCE(p_tags, ARRAY[]::text[]),
    p_taken_at,
    p_status::media_status,
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
  text,
  bigint,
  text,
  text,
  text,
  text[],
  timestamptz,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_media_gallery_upload(
  uuid,
  uuid,
  text,
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
