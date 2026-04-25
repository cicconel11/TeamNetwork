-- AI Cache Hit-Rate Daily View
--
-- Aggregates `ai_audit_log.cache_status` over the last 30 days, bucketed by day
-- and status. Powers `/api/admin/ai/cache-stats`. Row counts only — no per-org
-- data, no prompt content, no message ids.
--
-- RLS: ai_audit_log is service-role only (no policies). This view is exposed
-- through the same channel — no policies are added here, so only the service
-- role can SELECT.

CREATE OR REPLACE VIEW public.ai_cache_hit_rate_daily AS
WITH bucketed AS (
  SELECT
    date_trunc('day', created_at) AS day,
    COALESCE(cache_status, 'unset') AS cache_status
  FROM public.ai_audit_log
  WHERE created_at >= now() - interval '30 days'
)
SELECT
  day,
  cache_status,
  COUNT(*)::bigint AS count,
  ROUND(
    100.0 * COUNT(*)::numeric
      / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY day), 0),
    2
  ) AS pct_of_day
FROM bucketed
GROUP BY day, cache_status
ORDER BY day DESC, cache_status;

REVOKE ALL ON public.ai_cache_hit_rate_daily FROM PUBLIC;
REVOKE ALL ON public.ai_cache_hit_rate_daily FROM anon;
REVOKE ALL ON public.ai_cache_hit_rate_daily FROM authenticated;
GRANT SELECT ON public.ai_cache_hit_rate_daily TO service_role;

COMMENT ON VIEW public.ai_cache_hit_rate_daily IS
  'AI cache hit-rate aggregates by day and cache_status. Service-role only. Last 30 days.';
