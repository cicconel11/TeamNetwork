-- ===========================================================================
-- Alumni enrichment provenance (D11): record WHICH alumni columns were filled
-- by the LinkedIn enrichment writeback.
--
-- Both enrichment RPCs fill alumni columns via COALESCE(existing, enriched) —
-- the only moment "this value came from enrichment" is knowable is at write
-- time. We add alumni.enrichment_filled_fields text[] and re-create both RPCs
-- (copied verbatim from 20261208000000_apify_enrichment_richer_fields.sql,
-- the latest definitions) with ONE addition: each alumni UPDATE also unions
-- the newly-filled field names into enrichment_filled_fields. A field counts
-- as "filled by enrichment" when the value written to it came from the
-- enrichment payload:
--   - preserve mode (COALESCE(existing, enriched)): existing was NULL and the
--     payload supplied a non-null value (mirrors the existing NULL-only
--     semantics — these functions do not treat empty string as missing);
--   - overwrite mode (COALESCE(enriched, existing)): the payload supplied a
--     non-null value (it wins regardless of the prior value).
-- Merge semantics: union with any prior array, so a second enrichment run
-- adds newly-filled fields without erasing provenance from earlier runs.
-- Data-column update semantics are otherwise byte-for-byte unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance column (nullable, no default — NULL means "unknown /
--    pre-provenance", i.e. rows enriched before this migration).
-- ---------------------------------------------------------------------------
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS enrichment_filled_fields text[];

COMMENT ON COLUMN public.alumni.enrichment_filled_fields IS
  'Provenance list of alumni column names filled by the LinkedIn enrichment writeback. Consumed by the alumni edit UI ("Filled from LinkedIn") and stripped per-key when a human edits a field. NULL = unknown/pre-provenance.';

-- ---------------------------------------------------------------------------
-- 2. RPC: enrich_alumni_by_id — copied from 20261208000000, plus provenance.
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
  p_education_history jsonb DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_skills jsonb DEFAULT NULL,
  p_certifications jsonb DEFAULT NULL,
  p_languages jsonb DEFAULT NULL
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
    industry = COALESCE(industry, p_industry),
    photo_url = COALESCE(photo_url, p_photo_url),
    skills = COALESCE(skills, p_skills),
    certifications = COALESCE(certifications, p_certifications),
    languages = COALESCE(languages, p_languages),
    -- Provenance: union prior provenance with the fields this run fills
    -- (existing value NULL + payload non-null). Column refs on the RHS read
    -- the pre-update row.
    enrichment_filled_fields = COALESCE(
      (
        SELECT array_agg(DISTINCT f)
        FROM unnest(
          COALESCE(enrichment_filled_fields, '{}'::text[]) || array_remove(ARRAY[
            CASE WHEN job_title IS NULL AND p_job_title IS NOT NULL THEN 'job_title' END,
            CASE WHEN current_company IS NULL AND p_current_company IS NOT NULL THEN 'current_company' END,
            CASE WHEN current_city IS NULL AND p_current_city IS NOT NULL THEN 'current_city' END,
            CASE WHEN school IS NULL AND p_school IS NOT NULL THEN 'school' END,
            CASE WHEN major IS NULL AND p_major IS NOT NULL THEN 'major' END,
            CASE WHEN position_title IS NULL AND p_position_title IS NOT NULL THEN 'position_title' END,
            CASE WHEN headline IS NULL AND p_headline IS NOT NULL THEN 'headline' END,
            CASE WHEN summary IS NULL AND p_summary IS NOT NULL THEN 'summary' END,
            CASE WHEN work_history IS NULL AND p_work_history IS NOT NULL THEN 'work_history' END,
            CASE WHEN education_history IS NULL AND p_education_history IS NOT NULL THEN 'education_history' END,
            CASE WHEN industry IS NULL AND p_industry IS NOT NULL THEN 'industry' END,
            CASE WHEN photo_url IS NULL AND p_photo_url IS NOT NULL THEN 'photo_url' END,
            CASE WHEN skills IS NULL AND p_skills IS NOT NULL THEN 'skills' END,
            CASE WHEN certifications IS NULL AND p_certifications IS NOT NULL THEN 'certifications' END,
            CASE WHEN languages IS NULL AND p_languages IS NOT NULL THEN 'languages' END
          ], NULL)
        ) AS f
      ),
      enrichment_filled_fields
    ),
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

GRANT EXECUTE ON FUNCTION public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, text, jsonb, jsonb, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC: sync_user_linkedin_enrichment — copied from 20261208000000, plus
--    provenance on the alumni UPDATEs (members/parents have no provenance
--    column; their update semantics are untouched).
-- ---------------------------------------------------------------------------
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
  p_overwrite boolean DEFAULT false,
  p_industry text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_skills jsonb DEFAULT NULL,
  p_certifications jsonb DEFAULT NULL,
  p_languages jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_members_updated integer := 0;
  v_alumni_updated integer := 0;
  v_parents_updated integer := 0;
BEGIN
  IF p_overwrite THEN
    -- Overwrite mode: prefer the freshly-synced value.
    UPDATE public.members
    SET
      role = COALESCE(p_job_title, role),
      current_company = COALESCE(p_current_company, current_company),
      current_city = COALESCE(p_current_city, current_city),
      major = COALESCE(p_major, major),
      school = COALESCE(p_school, school),
      industry = COALESCE(p_industry, industry),
      headline = COALESCE(p_headline, headline),
      summary = COALESCE(p_summary, summary),
      work_history = COALESCE(p_work_history, work_history),
      education_history = COALESCE(p_education_history, education_history),
      skills = COALESCE(p_skills, skills),
      certifications = COALESCE(p_certifications, certifications),
      languages = COALESCE(p_languages, languages),
      photo_url = COALESCE(p_photo_url, photo_url)
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
      industry = COALESCE(p_industry, industry),
      photo_url = COALESCE(p_photo_url, photo_url),
      skills = COALESCE(p_skills, skills),
      certifications = COALESCE(p_certifications, certifications),
      languages = COALESCE(p_languages, languages),
      -- Provenance: in overwrite mode the payload value wins whenever it is
      -- non-null, so every non-null payload field was written by enrichment.
      enrichment_filled_fields = COALESCE(
        (
          SELECT array_agg(DISTINCT f)
          FROM unnest(
            COALESCE(enrichment_filled_fields, '{}'::text[]) || array_remove(ARRAY[
              CASE WHEN p_job_title IS NOT NULL THEN 'job_title' END,
              CASE WHEN p_position_title IS NOT NULL THEN 'position_title' END,
              CASE WHEN p_current_company IS NOT NULL THEN 'current_company' END,
              CASE WHEN p_current_city IS NOT NULL THEN 'current_city' END,
              CASE WHEN p_major IS NOT NULL THEN 'major' END,
              CASE WHEN p_school IS NOT NULL THEN 'school' END,
              CASE WHEN p_headline IS NOT NULL THEN 'headline' END,
              CASE WHEN p_summary IS NOT NULL THEN 'summary' END,
              CASE WHEN p_work_history IS NOT NULL THEN 'work_history' END,
              CASE WHEN p_education_history IS NOT NULL THEN 'education_history' END,
              CASE WHEN p_industry IS NOT NULL THEN 'industry' END,
              CASE WHEN p_photo_url IS NOT NULL THEN 'photo_url' END,
              CASE WHEN p_skills IS NOT NULL THEN 'skills' END,
              CASE WHEN p_certifications IS NOT NULL THEN 'certifications' END,
              CASE WHEN p_languages IS NOT NULL THEN 'languages' END
            ], NULL)
          ) AS f
        ),
        enrichment_filled_fields
      ),
      enrichment_status = 'enriched',
      enriched_at = now(),
      enrichment_error = NULL,
      enrichment_retry_count = 0
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;

    UPDATE public.parents
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
      industry = COALESCE(p_industry, industry),
      photo_url = COALESCE(p_photo_url, photo_url),
      skills = COALESCE(p_skills, skills),
      certifications = COALESCE(p_certifications, certifications),
      languages = COALESCE(p_languages, languages)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_parents_updated = ROW_COUNT;
  ELSE
    -- Preserve mode: only fill NULLs.
    UPDATE public.members
    SET
      role = COALESCE(role, p_job_title),
      current_company = COALESCE(current_company, p_current_company),
      current_city = COALESCE(current_city, p_current_city),
      major = COALESCE(major, p_major),
      school = COALESCE(school, p_school),
      industry = COALESCE(industry, p_industry),
      headline = COALESCE(headline, p_headline),
      summary = COALESCE(summary, p_summary),
      work_history = COALESCE(work_history, p_work_history),
      education_history = COALESCE(education_history, p_education_history),
      skills = COALESCE(skills, p_skills),
      certifications = COALESCE(certifications, p_certifications),
      languages = COALESCE(languages, p_languages),
      photo_url = COALESCE(photo_url, p_photo_url)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
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
      industry = COALESCE(industry, p_industry),
      photo_url = COALESCE(photo_url, p_photo_url),
      skills = COALESCE(skills, p_skills),
      certifications = COALESCE(certifications, p_certifications),
      languages = COALESCE(languages, p_languages),
      -- Provenance: union prior provenance with the fields this run fills
      -- (existing value NULL + payload non-null). Column refs on the RHS read
      -- the pre-update row.
      enrichment_filled_fields = COALESCE(
        (
          SELECT array_agg(DISTINCT f)
          FROM unnest(
            COALESCE(enrichment_filled_fields, '{}'::text[]) || array_remove(ARRAY[
              CASE WHEN job_title IS NULL AND p_job_title IS NOT NULL THEN 'job_title' END,
              CASE WHEN position_title IS NULL AND p_position_title IS NOT NULL THEN 'position_title' END,
              CASE WHEN current_company IS NULL AND p_current_company IS NOT NULL THEN 'current_company' END,
              CASE WHEN current_city IS NULL AND p_current_city IS NOT NULL THEN 'current_city' END,
              CASE WHEN major IS NULL AND p_major IS NOT NULL THEN 'major' END,
              CASE WHEN school IS NULL AND p_school IS NOT NULL THEN 'school' END,
              CASE WHEN headline IS NULL AND p_headline IS NOT NULL THEN 'headline' END,
              CASE WHEN summary IS NULL AND p_summary IS NOT NULL THEN 'summary' END,
              CASE WHEN work_history IS NULL AND p_work_history IS NOT NULL THEN 'work_history' END,
              CASE WHEN education_history IS NULL AND p_education_history IS NOT NULL THEN 'education_history' END,
              CASE WHEN industry IS NULL AND p_industry IS NOT NULL THEN 'industry' END,
              CASE WHEN photo_url IS NULL AND p_photo_url IS NOT NULL THEN 'photo_url' END,
              CASE WHEN skills IS NULL AND p_skills IS NOT NULL THEN 'skills' END,
              CASE WHEN certifications IS NULL AND p_certifications IS NOT NULL THEN 'certifications' END,
              CASE WHEN languages IS NULL AND p_languages IS NOT NULL THEN 'languages' END
            ], NULL)
          ) AS f
        ),
        enrichment_filled_fields
      ),
      enrichment_status = 'enriched',
      enriched_at = now(),
      enrichment_error = NULL,
      enrichment_retry_count = 0
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_alumni_updated = ROW_COUNT;

    UPDATE public.parents
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
      industry = COALESCE(industry, p_industry),
      photo_url = COALESCE(photo_url, p_photo_url),
      skills = COALESCE(skills, p_skills),
      certifications = COALESCE(certifications, p_certifications),
      languages = COALESCE(languages, p_languages)
    WHERE user_id = p_user_id
      AND deleted_at IS NULL;
    GET DIAGNOSTICS v_parents_updated = ROW_COUNT;
  END IF;

  -- Store raw enrichment JSON on the connection if provided.
  IF p_enrichment_json IS NOT NULL THEN
    UPDATE public.user_linkedin_connections
    SET linkedin_data = linkedin_data || jsonb_build_object('enrichment', p_enrichment_json)
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'updated_count', v_members_updated + v_alumni_updated + v_parents_updated
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb, text, text, jsonb, jsonb, boolean, text, text, jsonb, jsonb, jsonb) TO service_role;
