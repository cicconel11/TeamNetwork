-- One-time mobile auth handoffs created by the web OAuth callback.

CREATE TABLE IF NOT EXISTS public.mobile_auth_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobile_auth_handoffs_unconsumed_idx
  ON public.mobile_auth_handoffs (code_hash, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.mobile_auth_handoffs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mobile_auth_handoffs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_mobile_auth_handoff(p_code_hash text)
RETURNS TABLE (
  user_id uuid,
  encrypted_access_token text,
  encrypted_refresh_token text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.mobile_auth_handoffs
     SET consumed_at = now()
   WHERE id = (
     SELECT id
       FROM public.mobile_auth_handoffs
      WHERE code_hash = p_code_hash
        AND consumed_at IS NULL
        AND expires_at > now()
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING user_id, encrypted_access_token, encrypted_refresh_token;
$$;

REVOKE ALL ON FUNCTION public.consume_mobile_auth_handoff(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text) TO service_role;
