-- Fix alumni invite quota drift between current app buckets and older SQL helpers.
-- The app/runtime now uses:
--   none, 0-250, 251-500, 501-1000, 1001-2500, 2500-5000, 5000+
-- Older database helpers only recognized:
--   none, 0-200, 201-600, 601-1500, 1500+
-- That caused create_org_invite(..., 'alumni', ...) to fail with a false
-- "quota reached" error because unknown modern buckets fell through to 0.

CREATE OR REPLACE FUNCTION public.alumni_bucket_limit(p_bucket text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_bucket = 'none' OR p_bucket IS NULL THEN 0
    WHEN p_bucket = '0-250' THEN 250
    WHEN p_bucket = '251-500' THEN 500
    WHEN p_bucket = '501-1000' THEN 1000
    WHEN p_bucket = '1001-2500' THEN 2500
    WHEN p_bucket = '2500-5000' THEN 5000
    WHEN p_bucket = '5000+' THEN NULL
    -- Backward-compatible aliases for older rows/environments.
    WHEN p_bucket = '0-200' THEN 200
    WHEN p_bucket = '201-600' THEN 600
    WHEN p_bucket = '601-1500' THEN 1500
    WHEN p_bucket = '1500+' THEN NULL
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_alumni_quota(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_limit integer;
  v_count integer;
  v_status text;
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', 'Only admins can view alumni quota',
      'bucket', 'none',
      'alumni_limit', 0,
      'alumni_count', 0,
      'remaining', 0
    );
  END IF;

  SELECT alumni_bucket, status
  INTO v_bucket, v_status
  FROM public.organization_subscriptions
  WHERE organization_id = p_org_id
  LIMIT 1;

  v_bucket := COALESCE(v_bucket, 'none');
  v_limit := public.alumni_bucket_limit(v_bucket);

  SELECT COUNT(*) INTO v_count
  FROM public.alumni
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'allowed', true,
    'bucket', v_bucket,
    'status', COALESCE(v_status, 'pending'),
    'alumni_limit', v_limit,
    'alumni_count', v_count,
    'remaining', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(v_limit - v_count, 0) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_add_alumni(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_limit integer;
  v_count integer;
BEGIN
  SELECT COALESCE(alumni_bucket, 'none')
  INTO v_bucket
  FROM public.organization_subscriptions
  WHERE organization_id = p_org_id
  LIMIT 1;

  v_limit := public.alumni_bucket_limit(v_bucket);

  IF v_limit IS NULL THEN
    RETURN true;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.alumni
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  RETURN v_count < v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_alumni_quota(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_add_alumni(p_org_id) THEN
    RAISE EXCEPTION 'Alumni quota reached for this plan. Upgrade your subscription to add more alumni.';
  END IF;
END;
$$;
