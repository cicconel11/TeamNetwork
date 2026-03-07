DROP FUNCTION IF EXISTS public.bulk_import_linkedin_alumni(uuid, jsonb, boolean);

CREATE FUNCTION public.bulk_import_linkedin_alumni(
  p_organization_id uuid,
  p_rows jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS TABLE(out_email text, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enterprise_id uuid;
  v_limit integer;
  v_current_count integer;
  v_row jsonb;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_linkedin_url text;
  v_existing_id uuid;
  v_existing_linkedin_url text;
BEGIN
  SELECT enterprise_id
  INTO v_enterprise_id
  FROM public.organizations
  WHERE id = p_organization_id
  LIMIT 1;

  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(v_enterprise_id::text, p_organization_id::text)));

  IF v_enterprise_id IS NOT NULL THEN
    SELECT es.alumni_bucket_quantity * 2500
    INTO v_limit
    FROM public.enterprise_subscriptions es
    WHERE es.enterprise_id = v_enterprise_id
    LIMIT 1;

    SELECT COUNT(*)
    INTO v_current_count
    FROM public.alumni a
    INNER JOIN public.organizations o
      ON o.id = a.organization_id
    WHERE o.enterprise_id = v_enterprise_id
      AND a.deleted_at IS NULL;
  ELSE
    SELECT public.alumni_bucket_limit(os.alumni_bucket)
    INTO v_limit
    FROM public.organization_subscriptions os
    WHERE os.organization_id = p_organization_id
    LIMIT 1;

    SELECT COUNT(*)
    INTO v_current_count
    FROM public.alumni
    WHERE organization_id = p_organization_id
      AND deleted_at IS NULL;
  END IF;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_email := lower(trim(COALESCE(v_row->>'email', '')));
    v_first_name := trim(COALESCE(v_row->>'first_name', ''));
    v_last_name := trim(COALESCE(v_row->>'last_name', ''));
    v_linkedin_url := trim(COALESCE(v_row->>'linkedin_url', ''));

    IF v_email = '' OR v_linkedin_url = '' THEN
      CONTINUE;
    END IF;

    SELECT a.id, a.linkedin_url
    INTO v_existing_id, v_existing_linkedin_url
    FROM public.alumni a
    WHERE a.organization_id = p_organization_id
      AND a.deleted_at IS NULL
      AND a.email IS NOT NULL
      AND lower(a.email) = v_email
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      out_email := v_email;
      IF v_existing_linkedin_url IS NULL OR p_overwrite THEN
        UPDATE public.alumni
        SET linkedin_url = v_linkedin_url,
            updated_at = now()
        WHERE id = v_existing_id;
        out_status := 'updated_existing';
      ELSE
        out_status := 'skipped_existing';
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_limit IS NOT NULL AND v_current_count >= v_limit THEN
      out_email := v_email;
      out_status := 'quota_exceeded';
      RETURN NEXT;
      CONTINUE;
    END IF;

    INSERT INTO public.alumni (
      organization_id,
      first_name,
      last_name,
      email,
      linkedin_url
    )
    VALUES (
      p_organization_id,
      v_first_name,
      v_last_name,
      v_email,
      v_linkedin_url
    );

    v_current_count := v_current_count + 1;
    out_email := v_email;
    out_status := 'created';
    RETURN NEXT;
  END LOOP;
END;
$$;
