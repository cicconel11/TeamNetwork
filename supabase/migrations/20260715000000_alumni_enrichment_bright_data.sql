-- Add extended enrichment columns and enrichment status to alumni table
-- for Bright Data LinkedIn enrichment integration.

-- New enrichment data columns
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS skills text[];
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS work_history jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS education_history jsonb;

-- Enrichment status tracking
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_status text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_error text;

-- Index for cron job to find pending enrichments efficiently
CREATE INDEX IF NOT EXISTS idx_alumni_enrichment_pending
  ON public.alumni (enrichment_status)
  WHERE enrichment_status = 'pending' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- RPC: enrich_alumni_by_id
-- Used by the enrichment cron job for bulk-imported alumni (user_id IS NULL).
-- Scoped to a specific alumni record + organization for tenant isolation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrich_alumni_by_id(
  p_alumni_id uuid,
  p_organization_id uuid,
  p_job_title text DEFAULT NULL,
  p_current_company text DEFAULT NULL,
  p_current_city text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_major text DEFAULT NULL,
  p_position_title text DEFAULT NULL,
  p_headline text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_skills text[] DEFAULT NULL,
  p_work_history jsonb DEFAULT NULL,
  p_education_history jsonb DEFAULT NULL,
  p_enrichment_json jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.alumni
  SET
    job_title = COALESCE(job_title, p_job_title),
    position_title = COALESCE(position_title, p_position_title),
    current_company = COALESCE(current_company, p_current_company),
    current_city = COALESCE(current_city, p_current_city),
    major = COALESCE(major, p_major),
    school = COALESCE(school, p_school),
    headline = COALESCE(headline, p_headline),
    summary = COALESCE(summary, p_summary),
    skills = COALESCE(skills, p_skills),
    work_history = COALESCE(work_history, p_work_history),
    education_history = COALESCE(education_history, p_education_history),
    enrichment_status = 'enriched',
    enriched_at = now(),
    enrichment_error = NULL,
    updated_at = now()
  WHERE id = p_alumni_id
    AND organization_id = p_organization_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, text[], jsonb, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Update sync_user_linkedin_enrichment RPC
-- Add new fields (headline, summary, skills, work_history, education_history)
-- and p_overwrite param for manual sync force-refresh.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_user_linkedin_enrichment(
  p_user_id uuid,
  p_job_title text DEFAULT NULL,
  p_current_company text DEFAULT NULL,
  p_current_city text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_major text DEFAULT NULL,
  p_position_title text DEFAULT NULL,
  p_headline text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_work_history jsonb DEFAULT NULL,
  p_education_history jsonb DEFAULT NULL,
  p_enrichment_json jsonb DEFAULT NULL,
  p_overwrite boolean DEFAULT false
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
  -- Members: update NULL columns (or all if overwrite)
  IF p_overwrite THEN
    UPDATE public.members
    SET
      role = COALESCE(p_job_title, role),
      current_company = COALESCE(p_current_company, current_company),
      school = COALESCE(p_school, school)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
  ELSE
    UPDATE public.members
    SET
      role = COALESCE(role, p_job_title),
      current_company = COALESCE(current_company, p_current_company),
      school = COALESCE(school, p_school)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND (role IS NULL OR current_company IS NULL OR school IS NULL);
  END IF;
  GET DIAGNOSTICS v_members_updated = ROW_COUNT;

  -- Alumni: update NULL columns (or all if overwrite)
  IF p_overwrite THEN
    UPDATE public.alumni
    SET
      job_title = COALESCE(p_job_title, job_title),
      position_title = COALESCE(p_position_title, position_title),
      current_company = COALESCE(p_current_company, current_company),
      current_city = COALESCE(p_current_city, current_city),
      major = COALESCE(p_major, major),
      school = COALESCE(p_school, school),
      headline = COALESCE(p_headline, headline),
      summary = COALESCE(p_summary, summary),
      work_history = COALESCE(p_work_history, work_history),
      education_history = COALESCE(p_education_history, education_history),
      enrichment_status = 'enriched',
      enriched_at = now(),
      enrichment_error = NULL,
      updated_at = now()
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
  ELSE
    UPDATE public.alumni
    SET
      job_title = COALESCE(job_title, p_job_title),
      position_title = COALESCE(position_title, p_position_title),
      current_company = COALESCE(current_company, p_current_company),
      current_city = COALESCE(current_city, p_current_city),
      major = COALESCE(major, p_major),
      school = COALESCE(school, p_school),
      headline = COALESCE(headline, p_headline),
      summary = COALESCE(summary, p_summary),
      work_history = COALESCE(work_history, p_work_history),
      education_history = COALESCE(education_history, p_education_history),
      enrichment_status = 'enriched',
      enriched_at = now(),
      enrichment_error = NULL,
      updated_at = now()
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
  END IF;
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

-- Drop old signature and grant new one
DROP FUNCTION IF EXISTS public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb);
GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, boolean) TO service_role;
