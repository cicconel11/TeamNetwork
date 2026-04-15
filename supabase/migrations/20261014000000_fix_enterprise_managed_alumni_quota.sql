-- Fix alumni quota helpers for enterprise-managed organizations.
-- Enterprise-managed orgs intentionally store alumni_bucket = 'none' at the
-- org level because alumni capacity is pooled at the enterprise subscription.
-- Older helper functions only looked at organization_subscriptions.alumni_bucket,
-- which incorrectly blocked enterprise-managed alumni invites and inserts.

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
  v_enterprise_id uuid;
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

  SELECT os.alumni_bucket, os.status, o.enterprise_id
  INTO v_bucket, v_status, v_enterprise_id
  FROM public.organizations o
  LEFT JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  WHERE o.id = p_org_id
  LIMIT 1;

  v_bucket := COALESCE(v_bucket, 'none');
  v_status := COALESCE(v_status, 'pending');

  IF v_status = 'enterprise_managed' AND v_enterprise_id IS NOT NULL THEN
    SELECT COALESCE(es.alumni_bucket_quantity, 0) * 2500
    INTO v_limit
    FROM public.enterprise_subscriptions es
    WHERE es.enterprise_id = v_enterprise_id
    LIMIT 1;

    SELECT COUNT(*)
    INTO v_count
    FROM public.alumni a
    INNER JOIN public.organizations o
      ON o.id = a.organization_id
    INNER JOIN public.organization_subscriptions os
      ON os.organization_id = o.id
    WHERE o.enterprise_id = v_enterprise_id
      AND os.status = 'enterprise_managed'
      AND a.deleted_at IS NULL;

    RETURN jsonb_build_object(
      'allowed', true,
      'bucket', v_bucket,
      'status', v_status,
      'alumni_limit', COALESCE(v_limit, 0),
      'alumni_count', v_count,
      'remaining', GREATEST(COALESCE(v_limit, 0) - v_count, 0),
      'quota_scope', 'enterprise'
    );
  END IF;

  v_limit := public.alumni_bucket_limit(v_bucket);

  SELECT COUNT(*) INTO v_count
  FROM public.alumni
  WHERE organization_id = p_org_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'allowed', true,
    'bucket', v_bucket,
    'status', v_status,
    'alumni_limit', v_limit,
    'alumni_count', v_count,
    'remaining', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(v_limit - v_count, 0) END,
    'quota_scope', 'organization'
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
  v_status text;
  v_enterprise_id uuid;
BEGIN
  SELECT os.alumni_bucket, os.status, o.enterprise_id
  INTO v_bucket, v_status, v_enterprise_id
  FROM public.organizations o
  LEFT JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  WHERE o.id = p_org_id
  LIMIT 1;

  v_bucket := COALESCE(v_bucket, 'none');
  v_status := COALESCE(v_status, 'pending');

  IF v_status = 'enterprise_managed' AND v_enterprise_id IS NOT NULL THEN
    SELECT COALESCE(es.alumni_bucket_quantity, 0) * 2500
    INTO v_limit
    FROM public.enterprise_subscriptions es
    WHERE es.enterprise_id = v_enterprise_id
    LIMIT 1;

    SELECT COUNT(*)
    INTO v_count
    FROM public.alumni a
    INNER JOIN public.organizations o
      ON o.id = a.organization_id
    INNER JOIN public.organization_subscriptions os
      ON os.organization_id = o.id
    WHERE o.enterprise_id = v_enterprise_id
      AND os.status = 'enterprise_managed'
      AND a.deleted_at IS NULL;

    RETURN v_count < COALESCE(v_limit, 0);
  END IF;

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
