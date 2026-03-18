-- Add last_enriched_at column to track Proxycurl enrichment timing
ALTER TABLE public.user_linkedin_connections
  ADD COLUMN IF NOT EXISTS last_enriched_at timestamptz;

-- No backfill: there is no reliable proxy timestamp for historical enrichments.
-- Rows with linkedin_data->'enrichment' will be re-enriched on next cron cycle,
-- which correctly sets last_enriched_at = now() via the RPC.

-- Update the enrichment RPC to also set last_enriched_at on success
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

  -- Store raw enrichment JSON and set last_enriched_at in user_linkedin_connections
  IF p_enrichment_json IS NOT NULL THEN
    UPDATE public.user_linkedin_connections
    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json),
        last_enriched_at = now()
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'updated_count', v_members_updated + v_alumni_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb) TO service_role;
