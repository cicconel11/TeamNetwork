-- Usage Analytics: Tables, RLS policies, and RPC functions
-- FERPA/COPPA-compliant behavioral analytics with privacy-first design

-- =============================================================================
-- Table 1: analytics_consent — per-user opt-in consent tracking
-- =============================================================================
CREATE TABLE analytics_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consented BOOLEAN NOT NULL DEFAULT false,
  age_bracket TEXT,
  consented_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS: users can read/update their own row only
ALTER TABLE analytics_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own consent"
  ON analytics_consent FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own consent"
  ON analytics_consent FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own consent"
  ON analytics_consent FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- Table 2: usage_events — raw behavioral events (purged after 90 days)
-- NO PII columns: no IP, no user-agent, no content, no search queries
-- =============================================================================
CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  feature TEXT NOT NULL,
  duration_ms INTEGER,
  device_class TEXT,
  hour_of_day SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_event_type CHECK (event_type IN ('page_view', 'feature_enter', 'feature_exit', 'nav_click')),
  CONSTRAINT valid_device_class CHECK (device_class IS NULL OR device_class IN ('mobile', 'tablet', 'desktop')),
  CONSTRAINT valid_hour CHECK (hour_of_day IS NULL OR (hour_of_day >= 0 AND hour_of_day <= 23))
);

CREATE INDEX idx_usage_events_user_created ON usage_events (user_id, created_at);
CREATE INDEX idx_usage_events_org_created ON usage_events (organization_id, created_at);
CREATE INDEX idx_usage_events_type_created ON usage_events (event_type, created_at);

-- RLS: deny all public access, service role only
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
-- No policies = no public access; only service role key can read/write

-- =============================================================================
-- Table 3: usage_summaries — aggregated per-user/org feature usage
-- =============================================================================
CREATE TABLE usage_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  last_visited_at TIMESTAMPTZ,
  peak_hour SMALLINT,
  device_preference TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id, feature, period_start)
);

-- RLS: deny all public access, service role only
ALTER TABLE usage_summaries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Table 4: ui_profiles — LLM-generated personalization profiles (cached)
-- =============================================================================
CREATE TABLE ui_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile JSONB NOT NULL DEFAULT '{}',
  summary_hash TEXT NOT NULL,
  llm_provider TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE(user_id, organization_id)
);

-- RLS: users can read their own profile
ALTER TABLE ui_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own ui profile"
  ON ui_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- =============================================================================
-- Alter organizations: add org_type for FERPA scoping
-- =============================================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_type TEXT NOT NULL DEFAULT 'general'
  CHECK (org_type IN ('educational', 'athletic', 'general'));

-- =============================================================================
-- RPC: purge_expired_usage_events — deletes events older than 90 days
-- =============================================================================
CREATE OR REPLACE FUNCTION purge_expired_usage_events()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.usage_events
  WHERE created_at < now() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('deleted', deleted_count);
END;
$$;

-- =============================================================================
-- RPC: aggregate_usage_events — rolls raw events into weekly summaries
-- =============================================================================
CREATE OR REPLACE FUNCTION aggregate_usage_events(p_period_start DATE, p_period_end DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  upserted_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      e.user_id,
      e.organization_id,
      e.feature,
      COUNT(*) AS visit_count,
      COALESCE(SUM(e.duration_ms), 0) AS total_duration_ms,
      MAX(e.created_at) AS last_visited_at,
      -- peak_hour: most common hour_of_day
      (
        SELECT sub.hour_of_day
        FROM public.usage_events sub
        WHERE sub.user_id = e.user_id
          AND sub.organization_id IS NOT DISTINCT FROM e.organization_id
          AND sub.feature = e.feature
          AND sub.created_at >= p_period_start::timestamptz
          AND sub.created_at < p_period_end::timestamptz
          AND sub.hour_of_day IS NOT NULL
        GROUP BY sub.hour_of_day
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS peak_hour,
      -- device_preference: most common device_class
      (
        SELECT sub.device_class
        FROM public.usage_events sub
        WHERE sub.user_id = e.user_id
          AND sub.organization_id IS NOT DISTINCT FROM e.organization_id
          AND sub.feature = e.feature
          AND sub.created_at >= p_period_start::timestamptz
          AND sub.created_at < p_period_end::timestamptz
          AND sub.device_class IS NOT NULL
        GROUP BY sub.device_class
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS device_preference
    FROM public.usage_events e
    WHERE e.created_at >= p_period_start::timestamptz
      AND e.created_at < p_period_end::timestamptz
      AND e.organization_id IS NOT NULL
    GROUP BY e.user_id, e.organization_id, e.feature
  LOOP
    INSERT INTO public.usage_summaries (
      user_id, organization_id, feature,
      visit_count, total_duration_ms, last_visited_at,
      peak_hour, device_preference,
      period_start, period_end
    ) VALUES (
      r.user_id, r.organization_id, r.feature,
      r.visit_count, r.total_duration_ms, r.last_visited_at,
      r.peak_hour, r.device_preference,
      p_period_start, p_period_end
    )
    ON CONFLICT (user_id, organization_id, feature, period_start)
    DO UPDATE SET
      visit_count = EXCLUDED.visit_count,
      total_duration_ms = EXCLUDED.total_duration_ms,
      last_visited_at = EXCLUDED.last_visited_at,
      peak_hour = EXCLUDED.peak_hour,
      device_preference = EXCLUDED.device_preference,
      period_end = EXCLUDED.period_end;

    upserted_count := upserted_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', upserted_count);
END;
$$;
