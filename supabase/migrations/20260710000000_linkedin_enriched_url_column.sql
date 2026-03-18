-- Issue 1: URL corrections are blocked by the 30-day cooldown even when the
-- profile URL changed. Add last_enriched_url so the app can bypass the cooldown
-- when the URL differs from the previously enriched one.

-- 1. Add column
ALTER TABLE public.user_linkedin_connections
  ADD COLUMN IF NOT EXISTS last_enriched_url text;

-- 2. Replace enrichment RPC: add p_enriched_url parameter, set last_enriched_url
--    in both UPDATE and INSERT branches.
CREATE OR REPLACE FUNCTION public.sync_user_linkedin_enrichment(
  p_user_id uuid,
  p_job_title text DEFAULT NULL,
  p_current_company text DEFAULT NULL,
  p_current_city text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_major text DEFAULT NULL,
  p_position_title text DEFAULT NULL,
  p_enrichment_json jsonb DEFAULT NULL,
  p_enriched_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_members_updated integer := 0;
  v_alumni_updated integer := 0;
  v_conn_updated integer := 0;
BEGIN
  -- Members: update only NULL columns
  UPDATE public.members
  SET
    role = COALESCE(role, p_job_title),
    current_company = COALESCE(current_company, p_current_company),
    school = COALESCE(school, p_school)
  WHERE user_id = p_user_id
    AND deleted_at IS NULL
    AND (role IS NULL OR current_company IS NULL OR school IS NULL);
  GET DIAGNOSTICS v_members_updated = ROW_COUNT;

  -- Alumni: update only NULL columns
  UPDATE public.alumni
  SET
    job_title = COALESCE(job_title, p_job_title),
    position_title = COALESCE(position_title, p_position_title),
    current_company = COALESCE(current_company, p_current_company),
    current_city = COALESCE(current_city, p_current_city),
    major = COALESCE(major, p_major)
  WHERE user_id = p_user_id
    AND deleted_at IS NULL
    AND (job_title IS NULL OR position_title IS NULL OR current_company IS NULL
         OR current_city IS NULL OR major IS NULL);
  GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;

  -- Store raw enrichment JSON, last_enriched_at, and last_enriched_url
  -- in user_linkedin_connections. If no row exists, insert a sentinel.
  IF p_enrichment_json IS NOT NULL THEN
    UPDATE public.user_linkedin_connections
    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json),
        last_enriched_at = now(),
        last_enriched_url = p_enriched_url
    WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_conn_updated = ROW_COUNT;

    IF v_conn_updated = 0 THEN
      INSERT INTO public.user_linkedin_connections (
        user_id,
        linkedin_sub,
        status,
        access_token_encrypted,
        token_expires_at,
        linkedin_data,
        last_enriched_at,
        last_enriched_url
      ) VALUES (
        p_user_id,
        'manual::' || p_user_id,
        'enriched_only',
        '__none__',
        '1970-01-01T00:00:00Z'::timestamptz,
        jsonb_build_object('enrichment', p_enrichment_json),
        now(),
        p_enriched_url
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated_count', v_members_updated + v_alumni_updated
  );
END;
$$;

-- Grant for the new 9-param signature
GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb, text) TO service_role;
