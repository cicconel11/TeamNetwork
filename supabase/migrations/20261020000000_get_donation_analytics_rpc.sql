-- Migration: Add get_donation_analytics RPC + covering index
--
-- Replaces JS-side aggregation in src/lib/ai/tools/executor.ts::getDonationAnalytics
-- with a single SQL RPC call. Buckets in the org's IANA timezone (via
-- organizations.timezone) so reporting does not drift on UTC boundaries. Treats
-- both 'succeeded' and 'recorded' statuses as settled: the Node-side constant
-- SETTLED_DONATION_STATUSES in src/lib/payments/donation-status.ts is the
-- canonical mirror.

-- Part A: Covering partial index for (organization_id, created_at) range scans.
-- organization_donations previously had only (org_id) and (org_id, status)
-- partial indexes; a range scan by created_at fell back to sequential scan.

CREATE INDEX IF NOT EXISTS organization_donations_org_created_idx
  ON public.organization_donations (organization_id, created_at)
  WHERE deleted_at IS NULL;

-- Part B: RPC function.
-- status_counts.succeeded intentionally merges 'succeeded' + 'recorded' because
-- the rest of the product treats both as settled (see SETTLED_DONATION_STATUSES).
-- Advisory keys status_counts.recorded and status_counts.settled are emitted for
-- observability; the deterministic formatter ignores unknown keys.

CREATE OR REPLACE FUNCTION public.get_donation_analytics(
  p_org_id uuid,
  p_window_days int,
  p_bucket text,
  p_top_purposes_limit int
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tz text;
  v_window_start_local timestamp;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_bucket text;
  v_top_limit int;
  v_result jsonb;
BEGIN
  IF p_bucket NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'invalid bucket %', p_bucket USING ERRCODE = '22023';
  END IF;

  IF p_window_days IS NULL OR p_window_days < 1 THEN
    RAISE EXCEPTION 'invalid window_days %', p_window_days USING ERRCODE = '22023';
  END IF;

  v_bucket := p_bucket;
  v_top_limit := COALESCE(p_top_purposes_limit, 5);
  IF v_top_limit < 1 THEN
    v_top_limit := 5;
  END IF;

  SELECT COALESCE(NULLIF(o.timezone, ''), 'America/New_York')
    INTO v_tz
  FROM public.organizations o
  WHERE o.id = p_org_id;

  IF v_tz IS NULL THEN
    v_tz := 'America/New_York';
  END IF;

  v_window_end := now();
  v_window_start_local :=
    date_trunc('day', (v_window_end AT TIME ZONE v_tz))
    - make_interval(days => p_window_days - 1);
  v_window_start := v_window_start_local AT TIME ZONE v_tz;

  WITH windowed AS (
    SELECT
      d.amount_cents,
      d.status,
      d.created_at,
      d.purpose,
      date_trunc(v_bucket, d.created_at AT TIME ZONE v_tz) AS bucket_local,
      lower(btrim(d.purpose)) AS purpose_key
    FROM public.organization_donations d
    WHERE d.organization_id = p_org_id
      AND d.deleted_at IS NULL
      AND d.created_at >= v_window_start
  ),
  settled AS (
    SELECT * FROM windowed WHERE status IN ('succeeded', 'recorded')
  ),
  totals AS (
    SELECT
      COUNT(*)::int AS successful_count,
      COALESCE(SUM(amount_cents), 0)::bigint AS successful_amount_cents,
      MAX(amount_cents)::bigint AS largest_amount_cents,
      MAX(created_at) AS latest_at
    FROM settled
  ),
  status_mix AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'succeeded')::int AS c_succeeded,
      COUNT(*) FILTER (WHERE status = 'recorded')::int AS c_recorded,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS c_pending,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS c_failed,
      COUNT(*) FILTER (WHERE status NOT IN ('succeeded','recorded','pending','failed'))::int AS c_other,
      COUNT(*)::int AS overall
    FROM windowed
  ),
  trend_rows AS (
    SELECT
      bucket_local,
      COUNT(*)::int AS donation_count,
      SUM(amount_cents)::bigint AS amount_cents
    FROM settled
    GROUP BY bucket_local
    ORDER BY bucket_local
  ),
  trend_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'bucket_start', to_char((bucket_local AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'bucket_label',
          CASE v_bucket
            WHEN 'day'   THEN to_char(bucket_local, 'YYYY-MM-DD')
            WHEN 'week'  THEN 'Week of ' || to_char(bucket_local, 'YYYY-MM-DD')
            WHEN 'month' THEN to_char(bucket_local, 'YYYY-MM')
          END,
        'donation_count', donation_count,
        'amount_cents', amount_cents
      )
      ORDER BY bucket_local
    ) AS trend
    FROM trend_rows
  ),
  purpose_rows AS (
    SELECT
      COALESCE(NULLIF(purpose_key, ''), 'unspecified') AS purpose_key,
      MIN(CASE WHEN purpose IS NULL OR btrim(purpose) = '' THEN 'Unspecified'
               ELSE btrim(purpose) END) AS purpose_display,
      COUNT(*)::int AS donation_count,
      SUM(amount_cents)::bigint AS amount_cents
    FROM settled
    GROUP BY COALESCE(NULLIF(purpose_key, ''), 'unspecified')
    ORDER BY SUM(amount_cents) DESC NULLS LAST, COUNT(*) DESC
    LIMIT v_top_limit
  ),
  purposes_json AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'purpose', purpose_display,
        'donation_count', donation_count,
        'amount_cents', amount_cents
      )
    ) AS top_purposes
    FROM purpose_rows
  )
  SELECT jsonb_build_object(
    'window_days', p_window_days,
    'window_start', to_char(v_window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'window_end',   to_char(v_window_end   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'bucket', v_bucket,
    'timezone', v_tz,
    'totals', jsonb_build_object(
      'successful_donation_count', t.successful_count,
      'successful_amount_cents',   t.successful_amount_cents,
      'average_successful_amount_cents',
        CASE WHEN t.successful_count > 0
             THEN (t.successful_amount_cents / t.successful_count)::bigint
             ELSE NULL END,
      'largest_successful_amount_cents',
        CASE WHEN t.successful_count > 0 THEN t.largest_amount_cents ELSE NULL END,
      'overall_donation_count', sm.overall,
      'status_counts', jsonb_build_object(
        'succeeded', sm.c_succeeded + sm.c_recorded,
        'pending',   sm.c_pending + sm.c_other,
        'failed',    sm.c_failed,
        'recorded',  sm.c_recorded,
        'settled',   sm.c_succeeded + sm.c_recorded
      ),
      'latest_successful_donation_at',
        CASE WHEN t.latest_at IS NULL THEN NULL
             ELSE to_char(t.latest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        END
    ),
    'trend',        COALESCE((SELECT trend FROM trend_json), '[]'::jsonb),
    'top_purposes', COALESCE((SELECT top_purposes FROM purposes_json), '[]'::jsonb),
    'latest_successful_donation_at',
      CASE WHEN t.latest_at IS NULL THEN NULL
           ELSE to_char(t.latest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      END
  )
  INTO v_result
  FROM totals t
  CROSS JOIN status_mix sm;

  RETURN v_result;
END;
$$;

-- Part C: Restrict execute to service_role only. Executor always uses service
-- client after the upstream admin-role gate in the AI tool pipeline.
REVOKE EXECUTE ON FUNCTION public.get_donation_analytics(uuid, int, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_donation_analytics(uuid, int, text, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_donation_analytics(uuid, int, text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_donation_analytics(uuid, int, text, int) TO service_role;
