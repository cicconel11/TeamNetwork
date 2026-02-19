-- Add media storage quota to organization subscriptions and create stats RPC

-- 1. Quota column on organization_subscriptions
-- NULL = unlimited (enterprise). Default = 5 GB.
ALTER TABLE public.organization_subscriptions
  ADD COLUMN IF NOT EXISTS media_storage_quota_bytes bigint DEFAULT 5368709120;

-- 2. RPC: get_media_storage_stats(p_org_id uuid) → jsonb
-- Returns storage usage stats for an organization (admin only).
-- Follows the get_alumni_quota() pattern.
CREATE OR REPLACE FUNCTION public.get_media_storage_stats(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_quota_bytes bigint;
  v_items_count bigint;
  v_items_bytes bigint;
  v_uploads_count bigint;
  v_uploads_bytes bigint;
  v_total_bytes bigint;
  v_usage_percent numeric;
BEGIN
  -- Admin-only gate
  IF NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Only admins can view storage stats'
    );
  END IF;

  -- Fetch quota from subscription
  SELECT media_storage_quota_bytes
  INTO v_quota_bytes
  FROM public.organization_subscriptions
  WHERE organization_id = p_org_id
  LIMIT 1;

  -- Gallery items: non-deleted, active statuses
  SELECT
    COUNT(*),
    COALESCE(SUM(file_size_bytes), 0)
  INTO v_items_count, v_items_bytes
  FROM public.media_items
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL
    AND status IN ('uploading', 'pending', 'approved');

  -- Feature uploads: non-deleted, active statuses
  SELECT
    COUNT(*),
    COALESCE(SUM(file_size), 0)
  INTO v_uploads_count, v_uploads_bytes
  FROM public.media_uploads
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL
    AND status IN ('pending', 'ready');

  v_total_bytes := v_items_bytes + v_uploads_bytes;

  -- Calculate usage percent (NULL quota = unlimited = 0%)
  IF v_quota_bytes IS NOT NULL AND v_quota_bytes > 0 THEN
    v_usage_percent := ROUND((v_total_bytes::numeric / v_quota_bytes::numeric) * 100, 1);
  ELSE
    v_usage_percent := 0;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'total_bytes', v_total_bytes,
    'media_items_count', v_items_count,
    'media_items_bytes', v_items_bytes,
    'media_uploads_count', v_uploads_count,
    'media_uploads_bytes', v_uploads_bytes,
    'quota_bytes', v_quota_bytes,
    'usage_percent', v_usage_percent,
    'over_quota', CASE
      WHEN v_quota_bytes IS NULL THEN false
      ELSE v_total_bytes > v_quota_bytes
    END
  );
END;
$$;

-- Permissions: only authenticated users can call this RPC
REVOKE EXECUTE ON FUNCTION public.get_media_storage_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_media_storage_stats(uuid) TO authenticated;
