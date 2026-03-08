-- Extract shared quota resolution logic into a reusable helper function.
-- Both bulk_import_alumni_rich and bulk_import_linkedin_alumni previously
-- duplicated ~35 lines of identical enterprise/standalone quota logic.

CREATE FUNCTION public.resolve_alumni_quota(p_organization_id uuid)
RETURNS TABLE(quota_limit integer, quota_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enterprise_id uuid;
BEGIN
  -- 1. Resolve enterprise membership
  SELECT enterprise_id
  INTO v_enterprise_id
  FROM public.organizations
  WHERE id = p_organization_id
  LIMIT 1;

  -- 2. Advisory lock scoped to enterprise (or org if standalone)
  PERFORM pg_advisory_xact_lock(
    hashtext(COALESCE(v_enterprise_id::text, p_organization_id::text))
  );

  -- 3. Resolve limit + current count based on billing context
  IF v_enterprise_id IS NOT NULL THEN
    SELECT es.alumni_bucket_quantity * 2500
    INTO quota_limit
    FROM public.enterprise_subscriptions es
    WHERE es.enterprise_id = v_enterprise_id
    LIMIT 1;

    SELECT COUNT(*)::integer
    INTO quota_count
    FROM public.alumni a
    INNER JOIN public.organizations o
      ON o.id = a.organization_id
    WHERE o.enterprise_id = v_enterprise_id
      AND a.deleted_at IS NULL;
  ELSE
    SELECT public.alumni_bucket_limit(os.alumni_bucket)
    INTO quota_limit
    FROM public.organization_subscriptions os
    WHERE os.organization_id = p_organization_id
    LIMIT 1;

    SELECT COUNT(*)::integer
    INTO quota_count
    FROM public.alumni
    WHERE organization_id = p_organization_id
      AND deleted_at IS NULL;
  END IF;

  RETURN NEXT;
END;
$$;


-- Rewrite bulk_import_alumni_rich to use resolve_alumni_quota
DROP FUNCTION IF EXISTS public.bulk_import_alumni_rich(uuid, jsonb, boolean);

CREATE FUNCTION public.bulk_import_alumni_rich(
  p_organization_id uuid,
  p_rows jsonb,
  p_overwrite boolean DEFAULT false
)
RETURNS TABLE(out_email text, out_first_name text, out_last_name text, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_current_count integer;
  v_row jsonb;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_graduation_year integer;
  v_major text;
  v_job_title text;
  v_notes text;
  v_linkedin_url text;
  v_phone_number text;
  v_industry text;
  v_current_company text;
  v_current_city text;
  v_position_title text;
  v_existing_id uuid;
BEGIN
  SELECT q.quota_limit, q.quota_count
  INTO v_limit, v_current_count
  FROM public.resolve_alumni_quota(p_organization_id) q;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_email          := lower(trim(COALESCE(v_row->>'email', '')));
    v_first_name     := trim(COALESCE(v_row->>'first_name', ''));
    v_last_name      := trim(COALESCE(v_row->>'last_name', ''));
    v_graduation_year := CASE
                           WHEN v_row->>'graduation_year' IS NOT NULL AND v_row->>'graduation_year' <> ''
                           THEN (v_row->>'graduation_year')::integer
                           ELSE NULL
                         END;
    v_major          := NULLIF(trim(COALESCE(v_row->>'major', '')), '');
    v_job_title      := NULLIF(trim(COALESCE(v_row->>'job_title', '')), '');
    v_notes          := NULLIF(trim(COALESCE(v_row->>'notes', '')), '');
    v_linkedin_url   := NULLIF(trim(COALESCE(v_row->>'linkedin_url', '')), '');
    v_phone_number   := NULLIF(trim(COALESCE(v_row->>'phone_number', '')), '');
    v_industry       := NULLIF(trim(COALESCE(v_row->>'industry', '')), '');
    v_current_company := NULLIF(trim(COALESCE(v_row->>'current_company', '')), '');
    v_current_city   := NULLIF(trim(COALESCE(v_row->>'current_city', '')), '');
    v_position_title := NULLIF(trim(COALESCE(v_row->>'position_title', '')), '');

    -- Skip rows where both first_name and last_name are empty
    IF v_first_name = '' AND v_last_name = '' THEN
      CONTINUE;
    END IF;

    -- Email-based dedup (case-insensitive); rows without email always create
    IF v_email <> '' THEN
      SELECT a.id
      INTO v_existing_id
      FROM public.alumni a
      WHERE a.organization_id = p_organization_id
        AND a.deleted_at IS NULL
        AND a.email IS NOT NULL
        AND lower(a.email) = v_email
      LIMIT 1;
    ELSE
      v_existing_id := NULL;
    END IF;

    IF v_existing_id IS NOT NULL THEN
      out_email      := v_email;
      out_first_name := v_first_name;
      out_last_name  := v_last_name;
      IF p_overwrite THEN
        UPDATE public.alumni
        SET
          first_name      = COALESCE(NULLIF(v_first_name, ''), first_name),
          last_name       = COALESCE(NULLIF(v_last_name, ''), last_name),
          graduation_year = COALESCE(v_graduation_year, graduation_year),
          major           = COALESCE(v_major, major),
          job_title       = COALESCE(v_job_title, job_title),
          notes           = COALESCE(v_notes, notes),
          linkedin_url    = COALESCE(v_linkedin_url, linkedin_url),
          phone_number    = COALESCE(v_phone_number, phone_number),
          industry        = COALESCE(v_industry, industry),
          current_company = COALESCE(v_current_company, current_company),
          current_city    = COALESCE(v_current_city, current_city),
          position_title  = COALESCE(v_position_title, position_title),
          updated_at      = now()
        WHERE id = v_existing_id;
        out_status := 'updated_existing';
      ELSE
        out_status := 'skipped_existing';
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_limit IS NOT NULL AND v_current_count >= v_limit THEN
      out_email      := v_email;
      out_first_name := v_first_name;
      out_last_name  := v_last_name;
      out_status     := 'quota_exceeded';
      RETURN NEXT;
      CONTINUE;
    END IF;

    INSERT INTO public.alumni (
      organization_id,
      first_name,
      last_name,
      email,
      graduation_year,
      major,
      job_title,
      notes,
      linkedin_url,
      phone_number,
      industry,
      current_company,
      current_city,
      position_title
    )
    VALUES (
      p_organization_id,
      NULLIF(v_first_name, ''),
      NULLIF(v_last_name, ''),
      NULLIF(v_email, ''),
      v_graduation_year,
      v_major,
      v_job_title,
      v_notes,
      v_linkedin_url,
      v_phone_number,
      v_industry,
      v_current_company,
      v_current_city,
      v_position_title
    );

    v_current_count := v_current_count + 1;
    out_email      := v_email;
    out_first_name := v_first_name;
    out_last_name  := v_last_name;
    out_status     := 'created';
    RETURN NEXT;
  END LOOP;
END;
$$;


-- Rewrite bulk_import_linkedin_alumni to use resolve_alumni_quota
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
  SELECT q.quota_limit, q.quota_count
  INTO v_limit, v_current_count
  FROM public.resolve_alumni_quota(p_organization_id) q;

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
