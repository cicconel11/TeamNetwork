-- Supports dev-admin latency telemetry scans:
--   WHERE created_at >= $since ORDER BY created_at DESC LIMIT 50000
--
-- No repo migration currently uses CREATE INDEX CONCURRENTLY. Supabase CLI
-- migrations in this project are applied in a transaction, so CONCURRENTLY is
-- intentionally avoided here; run during a low-traffic window if ai_audit_log
-- has grown large.
CREATE INDEX IF NOT EXISTS ai_audit_log_created_at_idx
ON public.ai_audit_log (created_at DESC);
