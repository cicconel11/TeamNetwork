-- LinkedIn Re-Sync Feature
-- Adds org-level toggle and per-user monthly rate limiting for LinkedIn re-sync via Bright Data.

-- 1. Org toggle: admins can enable/disable LinkedIn re-sync per org
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS linkedin_resync_enabled boolean NOT NULL DEFAULT false;

-- 2. Rate limit columns on user_linkedin_connections
ALTER TABLE public.user_linkedin_connections
  ADD COLUMN IF NOT EXISTS resync_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resync_month text;

COMMENT ON COLUMN public.user_linkedin_connections.resync_count IS 'Number of manual re-syncs used in the current month';
COMMENT ON COLUMN public.user_linkedin_connections.resync_month IS 'Calendar month for rate limit tracking (YYYY-MM format)';

-- 3. Atomic rate-limited sync claim RPC
-- Returns { allowed: boolean, remaining?: number, reason?: string }
-- Resets count automatically when a new month begins.
-- Rate limit (2/month) is hardcoded — not caller-controllable.
CREATE OR REPLACE FUNCTION public.claim_linkedin_resync(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max_per_month CONSTANT integer := 2;
  v_current_month text := to_char(now(), 'YYYY-MM');
  v_row public.user_linkedin_connections%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.user_linkedin_connections
  WHERE user_id = p_user_id
  FOR UPDATE;  -- row-level lock to prevent race conditions

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_connection');
  END IF;

  -- New month: reset counter and allow
  IF v_row.resync_month IS DISTINCT FROM v_current_month THEN
    UPDATE public.user_linkedin_connections
    SET resync_count = 1, resync_month = v_current_month
    WHERE user_id = p_user_id;
    RETURN jsonb_build_object('allowed', true, 'remaining', v_max_per_month - 1);
  END IF;

  -- Rate limit check
  IF v_row.resync_count >= v_max_per_month THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'remaining', 0);
  END IF;

  -- Increment and allow
  UPDATE public.user_linkedin_connections
  SET resync_count = resync_count + 1
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('allowed', true, 'remaining', v_max_per_month - v_row.resync_count - 1);
END;
$$;

-- Restrict RPC to service_role only — prevents direct PostgREST invocation
REVOKE ALL ON FUNCTION public.claim_linkedin_resync(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_linkedin_resync(uuid) TO service_role;
