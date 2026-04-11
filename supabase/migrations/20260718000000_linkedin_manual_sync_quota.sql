-- Manual LinkedIn sync quota tracking independent of OAuth connections.
-- Supports URL-only Bright Data sync and reservation rollback on provider failures.

CREATE TABLE IF NOT EXISTS public.linkedin_manual_sync_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_key text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('reserved', 'completed', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS linkedin_manual_sync_attempts_user_month_idx
  ON public.linkedin_manual_sync_attempts (user_id, month_key);

CREATE INDEX IF NOT EXISTS linkedin_manual_sync_attempts_user_month_status_idx
  ON public.linkedin_manual_sync_attempts (user_id, month_key, status);

DROP TRIGGER IF EXISTS linkedin_manual_sync_attempts_set_updated_at
  ON public.linkedin_manual_sync_attempts;

CREATE TRIGGER linkedin_manual_sync_attempts_set_updated_at
  BEFORE UPDATE ON public.linkedin_manual_sync_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.linkedin_manual_sync_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_linkedin_manual_sync_status(
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
  v_consumed integer := 0;
BEGIN
  SELECT count(*)
  INTO v_consumed
  FROM public.linkedin_manual_sync_attempts
  WHERE user_id = p_user_id
    AND month_key = v_current_month
    AND (
      status = 'completed'
      OR (status = 'reserved' AND created_at >= now() - interval '30 minutes')
    );

  RETURN jsonb_build_object(
    'remaining',
    GREATEST(v_max_per_month - v_consumed, 0),
    'max_per_month',
    v_max_per_month
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_linkedin_manual_sync(
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
  v_consumed integer := 0;
  v_attempt_id uuid;
BEGIN
  SELECT count(*)
  INTO v_consumed
  FROM public.linkedin_manual_sync_attempts
  WHERE user_id = p_user_id
    AND month_key = v_current_month
    AND (
      status = 'completed'
      OR (status = 'reserved' AND created_at >= now() - interval '30 minutes')
    );

  IF v_consumed >= v_max_per_month THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'remaining', 0);
  END IF;

  INSERT INTO public.linkedin_manual_sync_attempts (
    user_id,
    month_key,
    status
  )
  VALUES (
    p_user_id,
    v_current_month,
    'reserved'
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'allowed',
    true,
    'attempt_id',
    v_attempt_id,
    'remaining',
    GREATEST(v_max_per_month - v_consumed - 1, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_linkedin_manual_sync(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.linkedin_manual_sync_attempts
  SET status = 'completed',
      completed_at = COALESCE(completed_at, now())
  WHERE id = p_attempt_id
    AND status <> 'released';

  RETURN jsonb_build_object('success', FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_linkedin_manual_sync(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.linkedin_manual_sync_attempts
  SET status = 'released',
      released_at = COALESCE(released_at, now())
  WHERE id = p_attempt_id
    AND status = 'reserved';

  RETURN jsonb_build_object('success', FOUND);
END;
$$;

REVOKE ALL ON TABLE public.linkedin_manual_sync_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_linkedin_manual_sync_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_linkedin_manual_sync(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_linkedin_manual_sync(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_linkedin_manual_sync(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_linkedin_manual_sync_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_linkedin_manual_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_linkedin_manual_sync(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_linkedin_manual_sync(uuid) TO service_role;
