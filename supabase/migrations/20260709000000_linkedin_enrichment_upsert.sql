-- Fix: manual-URL users have no user_linkedin_connections row, so
-- the UPDATE in sync_user_linkedin_enrichment is a no-op and enrichment
-- data + last_enriched_at are silently discarded (P2 regression from 32bdcc00).
--
-- Solution: expand status CHECK to allow 'enriched_only', then change the RPC
-- to INSERT a sentinel row when no row exists. The cron job filters on
-- status='connected', so 'enriched_only' rows are never picked up for batch runs.

-- 1. Expand the status CHECK constraint to include 'enriched_only'
ALTER TABLE public.user_linkedin_connections
  DROP CONSTRAINT user_linkedin_connections_status_check;
ALTER TABLE public.user_linkedin_connections
  ADD CONSTRAINT user_linkedin_connections_status_check
    CHECK (status IN ('connected', 'disconnected', 'error', 'enriched_only'));

-- 2. Replace the enrichment RPC with UPDATE + INSERT IF NOT FOUND logic
CREATE OR REPLACE FUNCTION public.sync_user_linkedin_enrichment(
  p_user_id uuid,
  p_job_title text DEFAULT NULL,
  p_current_company text DEFAULT NULL,
  p_current_city text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_major text DEFAULT NULL,
  p_position_title text DEFAULT NULL,
  p_enrichment_json jsonb DEFAULT NULL
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

  -- Store raw enrichment JSON and set last_enriched_at in user_linkedin_connections.
  -- If the user has no connection row (manual-URL-only user), insert a sentinel.
  IF p_enrichment_json IS NOT NULL THEN
    UPDATE public.user_linkedin_connections
    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json),
        last_enriched_at = now()
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
        last_enriched_at
      ) VALUES (
        p_user_id,
        'manual::' || p_user_id,
        'enriched_only',
        '__none__',
        '1970-01-01T00:00:00Z'::timestamptz,
        jsonb_build_object('enrichment', p_enrichment_json),
        now()
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated_count', v_members_updated + v_alumni_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb) TO service_role;
