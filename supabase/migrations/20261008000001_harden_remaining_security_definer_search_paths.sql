-- Harden remaining SECURITY DEFINER functions by pinning search_path to ''.
-- For functions that still relied on implicit public resolution, recompile the
-- body with fully-qualified names so runtime behavior stays unchanged.

BEGIN;

ALTER FUNCTION public.can_enterprise_add_alumni(uuid) SET search_path = '';
ALTER FUNCTION public.complete_enterprise_invite_redemption(text, uuid) SET search_path = '';
ALTER FUNCTION public.create_enterprise_invite(uuid, uuid, text, integer, timestamptz) SET search_path = '';
ALTER FUNCTION public.is_chat_group_creator(uuid) SET search_path = '';
ALTER FUNCTION public.is_chat_group_member(uuid) SET search_path = '';
ALTER FUNCTION public.is_chat_group_moderator(uuid) SET search_path = '';
ALTER FUNCTION public.is_enterprise_admin(uuid) SET search_path = '';
ALTER FUNCTION public.is_enterprise_member(uuid) SET search_path = '';
ALTER FUNCTION public.is_enterprise_owner(uuid) SET search_path = '';
ALTER FUNCTION public.is_org_admin(uuid) SET search_path = '';
ALTER FUNCTION public.is_org_member(uuid) SET search_path = '';
ALTER FUNCTION public.purge_expired_ai_semantic_cache() SET search_path = '';
ALTER FUNCTION public.purge_old_enterprise_audit_logs() SET search_path = '';
ALTER FUNCTION public.redeem_enterprise_invite(text) SET search_path = '';
ALTER FUNCTION public.redeem_org_invite(text) SET search_path = '';
ALTER FUNCTION public.reorder_media_albums(uuid, uuid[]) SET search_path = '';
ALTER FUNCTION public.reorder_media_gallery(uuid, uuid[]) SET search_path = '';
ALTER FUNCTION public.shift_media_album_sort_orders(uuid) SET search_path = '';
ALTER FUNCTION public.shift_media_gallery_sort_orders(uuid) SET search_path = '';
ALTER FUNCTION public.sync_enterprise_nav_to_org(uuid, uuid) SET search_path = '';
ALTER FUNCTION public.update_calendar_sync_preferences_updated_at() SET search_path = '';
ALTER FUNCTION public.update_event_calendar_entries_updated_at() SET search_path = '';
ALTER FUNCTION public.update_user_calendar_connections_updated_at() SET search_path = '';

CREATE OR REPLACE FUNCTION public.update_thread_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.discussion_threads
    SET reply_count = reply_count + 1,
        last_activity_at = now(),
        updated_at = now()
    WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE public.discussion_threads
    SET reply_count = GREATEST(reply_count - 1, 0),
        updated_at = now()
    WHERE id = NEW.thread_id;
  END IF;
  RETURN NEW;
END;
$$;

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
SET search_path = ''
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
    p_status::public.media_status,
    0
  )
  RETURNING id INTO v_media_id;

  RETURN v_media_id;
END;
$$;

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
SET search_path = ''
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
    p_status::public.media_status,
    0
  )
  RETURNING id INTO v_media_id;

  RETURN v_media_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.update_error_baselines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.error_groups
  SET
    baseline_rate_1h = COALESCE(baseline_rate_1h, 0) * 0.9 + count_1h * 0.1,
    count_24h = GREATEST(0, count_24h - CEIL(count_24h::numeric / 24)),
    count_1h = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_error_group(
  p_fingerprint text,
  p_title text,
  p_severity text,
  p_env text,
  p_sample_event jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  INSERT INTO public.error_groups (fingerprint, title, severity, env, sample_event)
  VALUES (p_fingerprint, p_title, p_severity, p_env, p_sample_event)
  ON CONFLICT (env, fingerprint) DO UPDATE SET
    last_seen_at = now(),
    count_1h = public.error_groups.count_1h + 1,
    count_24h = public.error_groups.count_24h + 1,
    total_count = public.error_groups.total_count + 1,
    sample_event = CASE
      WHEN public.error_groups.last_seen_at < now() - interval '5 minutes'
      THEN p_sample_event
      ELSE public.error_groups.sample_event
    END,
    status = CASE
      WHEN public.error_groups.status = 'resolved' THEN 'open'
      ELSE public.error_groups.status
    END
  RETURNING id INTO v_group_id;

  RETURN v_group_id;
END;
$$;

COMMENT ON FUNCTION public.upsert_error_group IS 'Atomically insert or update error group with count increment. sample_event refreshed only when last seen >5min ago to reduce write amplification.';

REVOKE ALL ON FUNCTION public.upsert_error_group(text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_error_group(text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_error_group(text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_error_group(text, text, text, text, jsonb) TO service_role;

COMMIT;
