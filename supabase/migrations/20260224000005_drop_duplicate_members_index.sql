-- Migration: Drop duplicate members partial index
--
-- Two functionally identical partial indexes exist on the members table:
--   members_org_deleted_idx     — created in 20251217100000_schema_fixes.sql
--   members_org_not_deleted_idx — created in 20260421130000_performance_security_lint_fixes.sql
--
-- Both index: ON members(organization_id) WHERE deleted_at IS NULL
-- Keeping both doubles the write overhead for every INSERT/UPDATE/DELETE on members.
-- Drop the older one; members_org_not_deleted_idx remains as the authoritative index.

DROP INDEX IF EXISTS public.members_org_deleted_idx;
