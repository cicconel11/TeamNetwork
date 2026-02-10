-- Fix: Count only page_view events in visit_count aggregation
--
-- Previously COUNT(*) counted all event types (page_view, feature_enter,
-- feature_exit, nav_click) per group, inflating visit_count by 2-3x.
-- This biases LLM-generated profiles toward features that are merely transited.
--
-- Also filters peak_hour and device_preference subqueries to page_view only
-- for consistency — these metrics should reflect actual visits, not enter/exit
-- bookkeeping events.

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
      COUNT(*) FILTER (WHERE e.event_type = 'page_view') AS visit_count,
      COALESCE(SUM(e.duration_ms), 0) AS total_duration_ms,
      MAX(e.created_at) AS last_visited_at,
      -- peak_hour: most common hour_of_day (page_view events only)
      (
        SELECT sub.hour_of_day
        FROM public.usage_events sub
        WHERE sub.user_id = e.user_id
          AND sub.organization_id IS NOT DISTINCT FROM e.organization_id
          AND sub.feature = e.feature
          AND sub.created_at >= p_period_start::timestamptz
          AND sub.created_at < p_period_end::timestamptz
          AND sub.hour_of_day IS NOT NULL
          AND sub.event_type = 'page_view'
        GROUP BY sub.hour_of_day
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS peak_hour,
      -- device_preference: most common device_class (page_view events only)
      (
        SELECT sub.device_class
        FROM public.usage_events sub
        WHERE sub.user_id = e.user_id
          AND sub.organization_id IS NOT DISTINCT FROM e.organization_id
          AND sub.feature = e.feature
          AND sub.created_at >= p_period_start::timestamptz
          AND sub.created_at < p_period_end::timestamptz
          AND sub.device_class IS NOT NULL
          AND sub.event_type = 'page_view'
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
