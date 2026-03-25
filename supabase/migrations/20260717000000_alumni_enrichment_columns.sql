-- Add enrichment columns to alumni table
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS work_history jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS education_history jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_status text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_error text;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_retry_count integer DEFAULT 0;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_snapshot_id text;

-- CHECK constraint on enrichment_status
ALTER TABLE public.alumni ADD CONSTRAINT alumni_enrichment_status_check
  CHECK (enrichment_status IS NULL OR enrichment_status IN ('pending', 'enriched', 'failed'));

-- Partial index for pending enrichment lookups
CREATE INDEX IF NOT EXISTS idx_alumni_enrichment_pending
  ON public.alumni (enrichment_status)
  WHERE enrichment_status = 'pending' AND deleted_at IS NULL AND linkedin_url IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RPC: enrich_alumni_by_id
-- Enriches a single alumni record by ID. Uses NULL-fill semantics
-- (COALESCE(existing, new_value)) so user edits are preserved.
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
  v_updated integer;
BEGIN
  UPDATE public.alumni
  SET
    job_title = COALESCE(job_title, p_job_title),
    current_company = COALESCE(current_company, p_current_company),
    current_city = COALESCE(current_city, p_current_city),
    school = COALESCE(school, p_school),
    major = COALESCE(major, p_major),
    position_title = COALESCE(position_title, p_position_title),
    headline = COALESCE(headline, p_headline),
    summary = COALESCE(summary, p_summary),
    work_history = COALESCE(work_history, p_work_history),
    education_history = COALESCE(education_history, p_education_history),
    enrichment_status = 'enriched',
    enriched_at = now(),
    enrichment_error = NULL,
    enrichment_retry_count = 0
  WHERE id = p_alumni_id
    AND organization_id = p_organization_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('updated_count', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: increment_enrichment_retry
-- Batch-increments retry count for alumni records and marks as failed
-- when max retries reached.
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
  WHERE id = ANY(p_alumni_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_enrichment_retry(uuid[], text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: sync_user_linkedin_enrichment (updated with new columns + overwrite)
-- Drop old 8-param signature, create new 13-param signature.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.sync_user_linkedin_enrichment(
  p_user_id uuid,
  p_job_title text DEFAULT NULL,
  p_current_company text DEFAULT NULL,
  p_current_city text DEFAULT NULL,
  p_school text DEFAULT NULL,
  p_major text DEFAULT NULL,
  p_position_title text DEFAULT NULL,
  p_enrichment_json jsonb DEFAULT NULL,
  p_headline text DEFAULT NULL,
  p_summary text DEFAULT NULL,
  p_work_history jsonb DEFAULT NULL,
  p_education_history jsonb DEFAULT NULL,
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
  IF p_overwrite THEN
    -- Overwrite mode: COALESCE(new, existing) — prefer new values
    UPDATE public.members
    SET
      role = COALESCE(p_job_title, role),
      current_company = COALESCE(p_current_company, current_company),
      school = COALESCE(p_school, school)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_members_updated = ROW_COUNT;

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
      enrichment_retry_count = 0
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;
  ELSE
    -- Preserve mode: COALESCE(existing, new) — only fill NULLs
    UPDATE public.members
    SET
      role = COALESCE(role, p_job_title),
      current_company = COALESCE(current_company, p_current_company),
      school = COALESCE(school, p_school)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND (role IS NULL OR current_company IS NULL OR school IS NULL);
    GET DIAGNOSTICS v_members_updated = ROW_COUNT;

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
      enrichment_retry_count = 0
    WHERE user_id = p_user_id
      AND deleted_at IS NULL
      AND (job_title IS NULL OR position_title IS NULL OR current_company IS NULL
           OR current_city IS NULL OR major IS NULL OR school IS NULL
           OR headline IS NULL OR summary IS NULL
           OR work_history IS NULL OR education_history IS NULL);
    GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb, text, text, jsonb, jsonb, boolean) TO service_role;
