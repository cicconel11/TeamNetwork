-- Migration: Create error tracking tables
-- Description: Tables for aggregating and storing application errors with RLS policies

-- =============================================================================
-- Table: error_groups
-- Purpose: Aggregate errors by fingerprint for deduplication and tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS error_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  env text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  count_1h integer NOT NULL DEFAULT 1,
  count_24h integer NOT NULL DEFAULT 1,
  total_count bigint NOT NULL DEFAULT 1,
  first_notified_at timestamptz NULL,
  last_notified_at timestamptz NULL,
  sample_event jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',

  -- Constraints
  CONSTRAINT error_groups_env_fingerprint_key UNIQUE (env, fingerprint),
  CONSTRAINT error_groups_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT error_groups_status_check CHECK (status IN ('open', 'resolved', 'ignored', 'muted'))
);

-- Repair uniqueness constraints for existing installs:
-- migrate legacy UNIQUE (fingerprint) to UNIQUE (env, fingerprint).
DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL (
      SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns_in_constraint
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    ) AS keys ON true
    WHERE n.nspname = 'public'
      AND t.relname = 'error_groups'
      AND c.contype = 'u'
      AND keys.columns_in_constraint = ARRAY['fingerprint']
  LOOP
    EXECUTE format('ALTER TABLE public.error_groups DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL (
      SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns_in_constraint
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    ) AS keys ON true
    WHERE n.nspname = 'public'
      AND t.relname = 'error_groups'
      AND c.contype = 'u'
      AND keys.columns_in_constraint = ARRAY['env', 'fingerprint']
  ) THEN
    ALTER TABLE public.error_groups
      ADD CONSTRAINT error_groups_env_fingerprint_key UNIQUE (env, fingerprint);
  END IF;
END $$;

-- Assert grouping uniqueness is scoped by environment + fingerprint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL (
      SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns_in_constraint
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    ) AS keys ON true
    WHERE n.nspname = 'public'
      AND t.relname = 'error_groups'
      AND c.contype = 'u'
      AND keys.columns_in_constraint = ARRAY['env', 'fingerprint']
  ) THEN
    RAISE EXCEPTION 'error_groups must have UNIQUE (env, fingerprint)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL (
      SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns_in_constraint
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    ) AS keys ON true
    WHERE n.nspname = 'public'
      AND t.relname = 'error_groups'
      AND c.contype = 'u'
      AND keys.columns_in_constraint = ARRAY['fingerprint']
  ) THEN
    RAISE EXCEPTION 'error_groups must not have global UNIQUE (fingerprint)';
  END IF;
END $$;

-- Comment on table and columns
COMMENT ON TABLE error_groups IS 'Aggregated error groups deduplicated by environment + fingerprint';
COMMENT ON COLUMN error_groups.fingerprint IS 'Hash identifying this error type within an environment';
COMMENT ON COLUMN error_groups.severity IS 'Error severity: low, medium, high, critical';
COMMENT ON COLUMN error_groups.env IS 'Environment: production, staging, development';
COMMENT ON COLUMN error_groups.count_1h IS 'Rolling count of occurrences in last hour';
COMMENT ON COLUMN error_groups.count_24h IS 'Rolling count of occurrences in last 24 hours';
COMMENT ON COLUMN error_groups.total_count IS 'Total occurrences since first seen';
COMMENT ON COLUMN error_groups.sample_event IS 'Most recent error event data for debugging';
COMMENT ON COLUMN error_groups.status IS 'Triage status: open, resolved, ignored, muted';

-- =============================================================================
-- Table: error_events
-- Purpose: Store individual error occurrences linked to groups
-- =============================================================================

CREATE TABLE IF NOT EXISTS error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES error_groups(id) ON DELETE CASCADE,
  env text NOT NULL,
  user_id text NULL,
  session_id text NULL,
  route text NULL,
  api_path text NULL,
  message text NOT NULL,
  stack text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comment on table and columns
COMMENT ON TABLE error_events IS 'Individual error event occurrences';
COMMENT ON COLUMN error_events.group_id IS 'Reference to parent error group';
COMMENT ON COLUMN error_events.user_id IS 'User ID if authenticated when error occurred';
COMMENT ON COLUMN error_events.session_id IS 'Session identifier for correlation';
COMMENT ON COLUMN error_events.route IS 'Frontend route where error occurred';
COMMENT ON COLUMN error_events.api_path IS 'API endpoint path if applicable';
COMMENT ON COLUMN error_events.meta IS 'Additional context: browser, OS, request data, etc.';

-- =============================================================================
-- Indexes
-- =============================================================================

-- error_groups indexes
-- Note: (env, fingerprint) unique constraint creates a supporting index

-- Index for querying errors by environment and recency (dashboard views)
CREATE INDEX IF NOT EXISTS idx_error_groups_env_last_seen
  ON error_groups (env, last_seen_at DESC);

-- Index for filtering by status (open errors dashboard)
CREATE INDEX IF NOT EXISTS idx_error_groups_status_last_seen
  ON error_groups (status, last_seen_at DESC)
  WHERE status = 'open';

-- error_events indexes

-- Index for fetching events by group with time ordering
CREATE INDEX IF NOT EXISTS idx_error_events_group_created
  ON error_events (group_id, created_at DESC);

-- Index for time-based cleanup/retention queries
CREATE INDEX IF NOT EXISTS idx_error_events_created_at
  ON error_events (created_at);

-- Index for user-specific error lookup (support debugging)
CREATE INDEX IF NOT EXISTS idx_error_events_user_id
  ON error_events (user_id)
  WHERE user_id IS NOT NULL;

-- =============================================================================
-- Row Level Security (RLS) Policies
-- Purpose: Only service role can read/write, no public access
-- =============================================================================

-- Enable RLS on both tables
ALTER TABLE error_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;

-- By default with RLS enabled and no policies, all access is denied.
-- The service role bypasses RLS entirely, so no explicit policies needed for it.
-- We add explicit deny-all policies to be defensive and document intent.

-- error_groups policies
-- Deny all access to anon and authenticated roles
DROP POLICY IF EXISTS "error_groups_no_public_select" ON error_groups;
CREATE POLICY "error_groups_no_public_select"
  ON error_groups
  FOR SELECT
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "error_groups_no_public_insert" ON error_groups;
CREATE POLICY "error_groups_no_public_insert"
  ON error_groups
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "error_groups_no_public_update" ON error_groups;
CREATE POLICY "error_groups_no_public_update"
  ON error_groups
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "error_groups_no_public_delete" ON error_groups;
CREATE POLICY "error_groups_no_public_delete"
  ON error_groups
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- error_events policies
-- Deny all access to anon and authenticated roles
DROP POLICY IF EXISTS "error_events_no_public_select" ON error_events;
CREATE POLICY "error_events_no_public_select"
  ON error_events
  FOR SELECT
  TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "error_events_no_public_insert" ON error_events;
CREATE POLICY "error_events_no_public_insert"
  ON error_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "error_events_no_public_update" ON error_events;
CREATE POLICY "error_events_no_public_update"
  ON error_events
  FOR UPDATE
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "error_events_no_public_delete" ON error_events;
CREATE POLICY "error_events_no_public_delete"
  ON error_events
  FOR DELETE
  TO anon, authenticated
  USING (false);

-- =============================================================================
-- Helper function: Upsert error group (for atomic increment)
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_error_group(
  p_fingerprint text,
  p_title text,
  p_severity text,
  p_env text,
  p_sample_event jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  INSERT INTO error_groups (fingerprint, title, severity, env, sample_event)
  VALUES (p_fingerprint, p_title, p_severity, p_env, p_sample_event)
  ON CONFLICT (env, fingerprint) DO UPDATE SET
    last_seen_at = now(),
    count_1h = error_groups.count_1h + 1,
    count_24h = error_groups.count_24h + 1,
    total_count = error_groups.total_count + 1,
    sample_event = p_sample_event,
    -- Reopen if new error comes in while resolved
    status = CASE
      WHEN error_groups.status = 'resolved' THEN 'open'
      ELSE error_groups.status
    END
  RETURNING id INTO v_group_id;

  RETURN v_group_id;
END;
$$;

COMMENT ON FUNCTION upsert_error_group IS 'Atomically insert or update error group with count increment';

-- Grant execute to service role only
REVOKE ALL ON FUNCTION upsert_error_group FROM PUBLIC;
REVOKE ALL ON FUNCTION upsert_error_group FROM anon;
REVOKE ALL ON FUNCTION upsert_error_group FROM authenticated;
GRANT EXECUTE ON FUNCTION upsert_error_group(text, text, text, text, jsonb) TO service_role;

-- =============================================================================
-- Add baseline columns for spike detection (if not exists)
-- =============================================================================

-- Add baseline_rate_1h if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'error_groups' AND column_name = 'baseline_rate_1h'
  ) THEN
    ALTER TABLE error_groups ADD COLUMN baseline_rate_1h numeric(10,4) DEFAULT 0;
  END IF;
END $$;

-- Add spike_threshold_1h if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'error_groups' AND column_name = 'spike_threshold_1h'
  ) THEN
    ALTER TABLE error_groups ADD COLUMN spike_threshold_1h integer DEFAULT 50;
  END IF;
END $$;

-- =============================================================================
-- Helper function: Update error baselines (hourly cron job)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_error_baselines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update baseline rates using exponential weighted moving average
  -- baseline = (baseline * 0.9) + (count_1h * 0.1)
  -- This gives more weight to historical data while still adapting to recent trends
  UPDATE error_groups
  SET
    -- Update baseline: 90% old baseline + 10% current hourly rate
    baseline_rate_1h = COALESCE(baseline_rate_1h, 0) * 0.9 + count_1h * 0.1,
    -- Decay 24h count: subtract the hourly portion (1/24)
    -- This approximates a sliding 24-hour window
    count_24h = GREATEST(0, count_24h - CEIL(count_24h::numeric / 24)),
    -- Reset hourly count
    count_1h = 0;
END;
$$;

COMMENT ON FUNCTION update_error_baselines IS 'Hourly cron job to update baseline rates and reset counts';

-- Grant execute to service role only
REVOKE ALL ON FUNCTION update_error_baselines FROM PUBLIC;
REVOKE ALL ON FUNCTION update_error_baselines FROM anon;
REVOKE ALL ON FUNCTION update_error_baselines FROM authenticated;
GRANT EXECUTE ON FUNCTION update_error_baselines() TO service_role;
