-- Add enrichment columns to members table (alumni already has these)
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS current_company text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS school text;

-- RPC: sync enrichment fields from Proxycurl to members/alumni records.
-- Only overwrites NULL fields so user edits are preserved.
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

  -- Store raw enrichment JSON in user_linkedin_connections if provided
  IF p_enrichment_json IS NOT NULL THEN
    UPDATE public.user_linkedin_connections
    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json)
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'updated_count', v_members_updated + v_alumni_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb) TO service_role;
