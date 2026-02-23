-- Migration: Reduce upsert_error_group jsonb write amplification
--
-- upsert_error_group is the highest cumulative offender: 28.8ms avg × 141 calls = 4,060ms.
-- The bottleneck is unconditionally overwriting sample_event (jsonb blob) on every conflict,
-- even for hot high-frequency errors hitting dozens of times per minute.
--
-- Fix: Only refresh sample_event when the error was last seen > 5 minutes ago.
-- Tradeoff: sample_event for hot errors may be up to 5 minutes stale.
-- This is acceptable — sample events are diagnostic snapshots, not real-time data.

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
    -- Only refresh sample_event if last seen > 5 minutes ago (reduce write amplification)
    sample_event = CASE
      WHEN error_groups.last_seen_at < now() - interval '5 minutes'
      THEN p_sample_event
      ELSE error_groups.sample_event
    END,
    -- Reopen if new error comes in while resolved
    status = CASE
      WHEN error_groups.status = 'resolved' THEN 'open'
      ELSE error_groups.status
    END
  RETURNING id INTO v_group_id;

  RETURN v_group_id;
END;
$$;

COMMENT ON FUNCTION upsert_error_group IS 'Atomically insert or update error group with count increment. sample_event refreshed only when last seen >5min ago to reduce write amplification.';
