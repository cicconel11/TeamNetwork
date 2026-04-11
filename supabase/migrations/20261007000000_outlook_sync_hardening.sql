ALTER TABLE public.user_calendar_connections
  ALTER COLUMN target_calendar_id DROP NOT NULL;

UPDATE public.user_calendar_connections
SET target_calendar_id = NULL
WHERE provider = 'outlook'
  AND target_calendar_id = 'primary';

ALTER TABLE public.user_calendar_connections
  ADD COLUMN IF NOT EXISTS microsoft_refresh_lock_id text,
  ADD COLUMN IF NOT EXISTS microsoft_refresh_lock_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_microsoft_token_refresh_lock(
  p_user_id uuid,
  p_lock_id text,
  p_lock_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.user_calendar_connections
  SET microsoft_refresh_lock_id = p_lock_id,
      microsoft_refresh_lock_expires_at = p_lock_expires_at
  WHERE user_id = p_user_id
    AND provider = 'outlook'
    AND (
      microsoft_refresh_lock_id IS NULL
      OR microsoft_refresh_lock_expires_at IS NULL
      OR microsoft_refresh_lock_expires_at < now()
      OR microsoft_refresh_lock_id = p_lock_id
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_microsoft_token_refresh_lock(
  p_user_id uuid,
  p_lock_id text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.user_calendar_connections
  SET microsoft_refresh_lock_id = NULL,
      microsoft_refresh_lock_expires_at = NULL
  WHERE user_id = p_user_id
    AND provider = 'outlook'
    AND microsoft_refresh_lock_id = p_lock_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_microsoft_token_refresh_lock(uuid, text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_microsoft_token_refresh_lock(uuid, text) TO authenticated, service_role;
