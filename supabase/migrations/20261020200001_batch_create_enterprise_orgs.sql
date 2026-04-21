-- =====================================================
-- Migration: Batch create enterprise sub-organizations
-- Date: 2026-10-20
-- Purpose: Atomic batch creation of enterprise sub-orgs with advisory lock,
--          quota enforcement, and per-row status reporting.
--          Follows the bulk_import_alumni_rich pattern.
-- =====================================================

DROP FUNCTION IF EXISTS public.batch_create_enterprise_orgs(uuid, uuid, jsonb);

CREATE FUNCTION public.batch_create_enterprise_orgs(
  p_enterprise_id uuid,
  p_user_id uuid,
  p_orgs jsonb
)
RETURNS TABLE(out_slug text, out_org_id uuid, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sub_org_quantity integer;
  v_current_count integer;
  v_batch_size integer;
  v_row jsonb;
  v_name text;
  v_slug text;
  v_description text;
  v_purpose text;
  v_primary_color text;
  v_enterprise_color text;
  v_new_org_id uuid;
BEGIN
  -- Prevent indefinite lock holding
  SET LOCAL statement_timeout = '10000';  -- 10 seconds

  -- Serialize batch operations per enterprise
  PERFORM pg_advisory_xact_lock(hashtext(p_enterprise_id::text));

  v_batch_size := jsonb_array_length(COALESCE(p_orgs, '[]'::jsonb));

  IF v_batch_size = 0 THEN
    RAISE EXCEPTION 'No organizations provided'
    USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_batch_size > 20 THEN
    RAISE EXCEPTION 'Maximum 20 organizations per batch (got %)', v_batch_size
    USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Fetch sub_org_quantity for hard cap enforcement
  SELECT es.sub_org_quantity
  INTO v_sub_org_quantity
  FROM public.enterprise_subscriptions es
  WHERE es.enterprise_id = p_enterprise_id
  LIMIT 1;

  -- Count existing enterprise-managed orgs
  SELECT COUNT(*)
  INTO v_current_count
  FROM public.organizations o
  INNER JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  WHERE o.enterprise_id = p_enterprise_id
    AND os.status = 'enterprise_managed'
    -- Note: organizations table has no deleted_at column;

  -- Hard cap check for entire batch (NULL = legacy unlimited)
  IF v_sub_org_quantity IS NOT NULL
     AND (v_current_count + v_batch_size) > v_sub_org_quantity THEN
    RAISE EXCEPTION 'Batch would exceed org limit: % existing + % new > % allowed',
      v_current_count, v_batch_size, v_sub_org_quantity
    USING ERRCODE = 'check_violation';
  END IF;

  -- Fetch enterprise primary_color for fallback
  SELECT e.primary_color
  INTO v_enterprise_color
  FROM public.enterprises e
  WHERE e.id = p_enterprise_id
  LIMIT 1;

  -- Iterate and create each org
  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_orgs, '[]'::jsonb))
  LOOP
    v_name         := trim(COALESCE(v_row->>'name', ''));
    v_slug         := trim(COALESCE(v_row->>'slug', ''));
    v_description  := NULLIF(trim(COALESCE(v_row->>'description', '')), '');
    v_purpose      := NULLIF(trim(COALESCE(v_row->>'purpose', '')), '');
    v_primary_color := COALESCE(
      NULLIF(trim(COALESCE(v_row->>'primary_color', '')), ''),
      v_enterprise_color,
      '#1e3a5f'
    );

    IF v_name = '' OR v_slug = '' THEN
      out_slug   := COALESCE(NULLIF(v_slug, ''), v_name);
      out_org_id := NULL;
      out_status := 'error: name and slug are required';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      -- Insert organization
      INSERT INTO public.organizations (
        name, slug, description, purpose, primary_color,
        enterprise_id, enterprise_relationship_type
      )
      VALUES (
        v_name, v_slug, v_description, v_purpose, v_primary_color,
        p_enterprise_id, 'created'
      )
      RETURNING id INTO v_new_org_id;

      -- Grant creator admin role
      INSERT INTO public.user_organization_roles (
        user_id, organization_id, role
      )
      VALUES (
        p_user_id, v_new_org_id, 'admin'
      );

      -- Create enterprise_managed subscription
      INSERT INTO public.organization_subscriptions (
        organization_id, status, base_plan_interval, alumni_bucket
      )
      VALUES (
        v_new_org_id, 'enterprise_managed', 'month', 'none'
      );

      out_slug   := v_slug;
      out_org_id := v_new_org_id;
      out_status := 'created';
      RETURN NEXT;

    EXCEPTION
      WHEN unique_violation THEN
        out_slug   := v_slug;
        out_org_id := NULL;
        out_status := 'slug_conflict';
        RETURN NEXT;
        -- Note: In a transaction, this exception causes the entire
        -- transaction to be in an aborted state unless we use a SAVEPOINT.
        -- Since we want atomicity (all-or-nothing), we let it propagate.
        RAISE EXCEPTION 'Slug "%" is already taken', v_slug
        USING ERRCODE = 'unique_violation';
    END;
  END LOOP;
END;
$$;

-- Lock down access: service_role only
REVOKE ALL ON FUNCTION public.batch_create_enterprise_orgs(uuid, uuid, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_create_enterprise_orgs(uuid, uuid, jsonb)
  TO service_role;
