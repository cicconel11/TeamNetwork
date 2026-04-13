-- Fix compliance regressions in deletion tracking and privileged audit helpers.

-- Preserve deletion requests after auth.users removal so the cron can mark
-- them completed and leave an audit trail.
ALTER TABLE public.user_deletion_requests
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.user_deletion_requests
  DROP CONSTRAINT IF EXISTS user_deletion_requests_user_id_fkey;

COMMENT ON COLUMN public.user_deletion_requests.completed_at IS
  'Timestamp when the scheduled account deletion was successfully processed.';

-- Restrict the new privileged audit retention function to service-role usage
-- and pin the search_path to an empty value.
CREATE OR REPLACE FUNCTION public.purge_old_data_access_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.data_access_log
  WHERE accessed_at < now() - interval '365 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_old_data_access_logs() FROM public;
REVOKE EXECUTE ON FUNCTION public.purge_old_data_access_logs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_old_data_access_logs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_data_access_logs() TO service_role;

-- Restrict the manual IP hash backfill helper to service-role usage and harden
-- its search path.
CREATE OR REPLACE FUNCTION public.backfill_ip_hashes(salt text)
RETURNS TABLE(table_name text, updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cnt integer;
BEGIN
  UPDATE public.enterprise_audit_logs
  SET ip_address = encode(
    extensions.digest(salt || ':' || ip_address, 'sha256'),
    'hex'
  )
  WHERE ip_address IS NOT NULL
    AND length(ip_address) < 64;

  GET DIAGNOSTICS cnt = ROW_COUNT;
  table_name := 'enterprise_audit_logs';
  updated_count := cnt;
  RETURN NEXT;

  UPDATE public.dev_admin_audit_logs
  SET ip_address = encode(
    extensions.digest(salt || ':' || ip_address, 'sha256'),
    'hex'
  )
  WHERE ip_address IS NOT NULL
    AND length(ip_address) < 64;

  GET DIAGNOSTICS cnt = ROW_COUNT;
  table_name := 'dev_admin_audit_logs';
  updated_count := cnt;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_ip_hashes(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.backfill_ip_hashes(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_ip_hashes(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_ip_hashes(text) TO service_role;
