-- Migration: Drop unused dev_admin_audit_logs indexes
--
-- These 4 indexes have 0 scans in production and add ~28ms overhead
-- to every INSERT into dev_admin_audit_logs. The table is write-only
-- audit logging — no application code reads it with WHERE filters.
-- Indexes can be re-added if a dashboard query ever needs them.

DROP INDEX IF EXISTS public.dev_admin_audit_logs_admin_user_idx;
DROP INDEX IF EXISTS public.dev_admin_audit_logs_action_idx;
DROP INDEX IF EXISTS public.dev_admin_audit_logs_target_id_idx;
DROP INDEX IF EXISTS public.dev_admin_audit_logs_created_at_idx;
