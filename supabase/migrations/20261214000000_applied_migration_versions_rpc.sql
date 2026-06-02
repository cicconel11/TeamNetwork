-- Expose the applied-migration ledger to the CI drift check.
--
-- WHY: supabase_migrations.schema_migrations is not in the PostgREST-exposed
-- schema, so a CI job using supabase-js (service_role) cannot read it directly.
-- This SECURITY DEFINER RPC returns just the version strings so the drift check
-- can diff repo migration files against what is actually applied to the target
-- project and fail when a committed migration was never applied.
--
-- Read-only, returns only opaque version timestamps (no schema/data), and is
-- locked to service_role -- anon/authenticated cannot enumerate the ledger.

CREATE OR REPLACE FUNCTION public.applied_migration_versions()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT version
  FROM supabase_migrations.schema_migrations
  ORDER BY version;
$$;

COMMENT ON FUNCTION public.applied_migration_versions IS
  'Returns applied migration version strings from the Supabase ledger. service_role only; used by the CI migration drift check.';

REVOKE EXECUTE ON FUNCTION public.applied_migration_versions FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.applied_migration_versions FROM anon;
REVOKE EXECUTE ON FUNCTION public.applied_migration_versions FROM authenticated;
GRANT EXECUTE ON FUNCTION public.applied_migration_versions TO service_role;
