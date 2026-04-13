-- Phase 3 (B3): Backfill function to hash existing raw IP addresses
--
-- Must be run manually with actual salt value:
--   SELECT backfill_ip_hashes('your-salt-value');
--
-- Detects already-hashed values by length (SHA-256 hex = 64 chars).
-- Uses pgcrypto's digest() which is already enabled.

CREATE OR REPLACE FUNCTION public.backfill_ip_hashes(salt TEXT)
RETURNS TABLE(table_name TEXT, updated_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cnt INTEGER;
BEGIN
  -- enterprise_audit_logs
  UPDATE enterprise_audit_logs
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

  -- dev_admin_audit_logs
  UPDATE dev_admin_audit_logs
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
