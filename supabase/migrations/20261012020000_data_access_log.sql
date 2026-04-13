-- Phase 3 (A2): Access audit logging for FERPA compliance
--
-- Tracks admin-initiated access to sensitive education records:
-- data exports, form submission views, roster downloads, member profiles.

CREATE TABLE public.data_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ip_hash         TEXT,
  user_agent      TEXT,
  accessed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX data_access_log_actor_idx ON public.data_access_log(actor_user_id);
CREATE INDEX data_access_log_resource_idx ON public.data_access_log(resource_type, resource_id);
CREATE INDEX data_access_log_org_idx ON public.data_access_log(organization_id);
CREATE INDEX data_access_log_accessed_at_idx ON public.data_access_log(accessed_at);

-- Service-role-only: no authenticated user should read/write directly
ALTER TABLE public.data_access_log ENABLE ROW LEVEL SECURITY;

-- 365-day purge function for retention cron
CREATE OR REPLACE FUNCTION public.purge_old_data_access_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.data_access_log
  WHERE accessed_at < now() - interval '365 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
