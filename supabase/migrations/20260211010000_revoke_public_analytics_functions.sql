-- Revoke PUBLIC access from analytics functions that should only be called by service_role
-- These functions are for scheduled jobs only and should not be publicly accessible

-- purge_expired_usage_events() — from usage_analytics.sql
REVOKE ALL ON FUNCTION public.purge_expired_usage_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_usage_events() TO service_role;

-- aggregate_usage_events(DATE, DATE) — from usage_analytics.sql
REVOKE ALL ON FUNCTION public.aggregate_usage_events(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aggregate_usage_events(DATE, DATE) TO service_role;

-- purge_analytics_events() — from analytics_events.sql
REVOKE ALL ON FUNCTION public.purge_analytics_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_analytics_events() TO service_role;

-- purge_ops_events() — from analytics_events.sql
REVOKE ALL ON FUNCTION public.purge_ops_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_ops_events() TO service_role;
