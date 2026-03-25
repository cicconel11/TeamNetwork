-- Add extended enrichment columns and enrichment status to alumni table
-- for Bright Data LinkedIn enrichment integration.

-- New enrichment data columns
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS work_history jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS education_history jsonb;

-- Enrichment status tracking
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_status text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_error text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_retry_count integer DEFAULT 0;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_snapshot_id text;

-- Constrain enrichment_status to valid values
ALTER TABLE public.alumni ADD CONSTRAINT chk_alumni_enrichment_status
  CHECK (enrichment_status IS NULL OR enrichment_status IN ('pending', 'enriched', 'failed'));

-- Index for cron job to find pending enrichments efficiently
CREATE INDEX IF NOT EXISTS idx_alumni_enrichment_pending
  ON public.alumni (enrichment_status)
  WHERE enrichment_status = 'pending' AND deleted_at IS NULL AND linkedin_url IS NOT NULL;

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
  p_work_history jsonb DEFAULT NULL,
  p_education_history jsonb DEFAULT NULL
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
    work_history = COALESCE(work_history, p_work_history),
    education_history = COALESCE(education_history, p_education_history),
    enrichment_status = 'enriched',
    enriched_at = now(),
    enrichment_error = NULL,
    enrichment_retry_count = 0,
    updated_at = now()
  WHERE id = p_alumni_id
    AND organization_id = p_organization_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Update sync_user_linkedin_enrichment RPC
-- Add new fields (headline, summary, work_history, education_history)
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
      enrichment_retry_count = 0,
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
      enrichment_retry_count = 0,
      updated_at = now()
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND (job_title IS NULL OR position_title IS NULL OR current_company IS NULL
           OR current_city IS NULL OR major IS NULL OR school IS NULL OR headline IS NULL
           OR summary IS NULL OR work_history IS NULL OR education_history IS NULL);
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

-- ---------------------------------------------------------------------------
-- RPC: increment_enrichment_retry
-- Batch increment retry count for failed enrichment attempts.
-- Marks as 'failed' if max retries reached.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_enrichment_retry(
  p_alumni_ids uuid[],
  p_error text DEFAULT NULL,
  p_max_retries integer DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.alumni
  SET
    enrichment_retry_count = enrichment_retry_count + 1,
    enrichment_error = p_error,
    enrichment_snapshot_id = NULL,
    enrichment_status = CASE
      WHEN enrichment_retry_count + 1 >= p_max_retries THEN 'failed'
      ELSE 'pending'
    END
  WHERE id = ANY(p_alumni_ids)
    AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_enrichment_retry(uuid[], text, integer) TO service_role;
