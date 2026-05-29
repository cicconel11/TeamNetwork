-- ===========================================================================
-- Apify enrichment migration: richer profile fields + 'syncing' status +
-- parents enrichment + async run tracking.
--
-- Context: replacing BrightData with Apify. Apify runs are async, so alumni
-- gain a 'syncing' status; per-user connections track the in-flight run. We
-- also start populating industry + photo + skills/certifications/languages,
-- and extend enrichment to the parents table (previously read-only).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. New richer columns
-- ---------------------------------------------------------------------------

-- alumni already has: headline, summary, work_history, education_history,
-- industry, photo_url. Only the new structured lists are missing.
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS skills jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS certifications jsonb;
ALTER TABLE public.alumni ADD COLUMN IF NOT EXISTS languages jsonb;

-- members: gains the rich profile fields (already has current_company,
-- current_city, major, school, role, bio, photo_url).
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS work_history jsonb;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS education_history jsonb;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS skills jsonb;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS certifications jsonb;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS languages jsonb;

-- parents: previously had only linkedin_url/photo_url. Add the enrichment set
-- so parent LinkedIn data has somewhere to land.
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS position_title text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS current_company text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS current_city text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS school text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS major text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS work_history jsonb;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS education_history jsonb;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS skills jsonb;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS certifications jsonb;
ALTER TABLE public.parents ADD COLUMN IF NOT EXISTS languages jsonb;

-- ---------------------------------------------------------------------------
-- 2. Async run tracking
-- ---------------------------------------------------------------------------

-- Allow 'syncing' (Apify run in flight) on alumni enrichment_status.
ALTER TABLE public.alumni DROP CONSTRAINT IF EXISTS alumni_enrichment_status_check;
ALTER TABLE public.alumni ADD CONSTRAINT alumni_enrichment_status_check
  CHECK (enrichment_status IS NULL OR enrichment_status IN ('pending', 'syncing', 'enriched', 'failed'));

-- Per-user self-sync tracks its in-flight Apify run here (the alumni queue uses
-- enrichment_snapshot_id; user_linkedin_connections needs its own run handle).
ALTER TABLE public.user_linkedin_connections ADD COLUMN IF NOT EXISTS enrichment_run_id text;
ALTER TABLE public.user_linkedin_connections ADD COLUMN IF NOT EXISTS enrichment_status text;
ALTER TABLE public.user_linkedin_connections DROP CONSTRAINT IF EXISTS user_linkedin_connections_enrichment_status_check;
ALTER TABLE public.user_linkedin_connections ADD CONSTRAINT user_linkedin_connections_enrichment_status_check
  CHECK (enrichment_status IS NULL OR enrichment_status IN ('pending', 'syncing', 'enriched', 'failed'));

-- Webhook idempotency: dedup Apify run-finished deliveries.
CREATE TABLE IF NOT EXISTS public.apify_webhook_events (
  id text PRIMARY KEY,
  run_id text,
  event_type text,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.apify_webhook_events ENABLE ROW LEVEL SECURITY;
-- Service-role only (webhook uses the service client); no public policies.

-- Run-target mapping: every started Apify run records the rows it will write back
-- to. The webhook (and reconciliation cron) match dataset items to these rows by
-- normalized linkedin_url. This is what lets us enrich members/parents (which have
-- no enrichment_status column) and per-user profiles uniformly.
CREATE TABLE IF NOT EXISTS public.linkedin_enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  -- 'user' -> write members/alumni/parents for user_id via sync_user_linkedin_enrichment
  -- 'alumni' -> write a single alumni row via enrich_alumni_by_id
  target_kind text NOT NULL CHECK (target_kind IN ('user', 'alumni')),
  user_id uuid,
  alumni_id uuid,
  organization_id uuid,
  linkedin_url text NOT NULL,
  status text NOT NULL DEFAULT 'syncing' CHECK (status IN ('syncing', 'enriched', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.linkedin_enrichment_runs ENABLE ROW LEVEL SECURITY;
-- Service-role only (webhook + crons use the service client); no public policies.
CREATE INDEX IF NOT EXISTS idx_linkedin_enrichment_runs_run_id
  ON public.linkedin_enrichment_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_enrichment_runs_syncing
  ON public.linkedin_enrichment_runs (status, created_at)
  WHERE status = 'syncing';

-- ---------------------------------------------------------------------------
-- 3. RPC: enrich_alumni_by_id (add industry, photo, skills, certs, languages)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb);

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
-- 4. RPC: sync_user_linkedin_enrichment
-- Adds industry/photo/skills/certs/languages, and writes the parents table.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_user_linkedin_enrichment(uuid, text, text, text, text, text, text, jsonb, text, text, jsonb, jsonb, boolean);

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
