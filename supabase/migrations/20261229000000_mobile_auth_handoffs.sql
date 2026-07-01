-- Mobile auth handoff: capture the table + consume RPC that until now existed
-- only in the production database (created out-of-band). Without this migration
-- the web->mobile OAuth handoff is broken in every non-prod environment (local,
-- CI, preview) because `mobile_auth_handoffs` and `consume_mobile_auth_handoff`
-- do not exist there, and POST /api/auth/mobile-handoff/consume 500s.
--
-- Written idempotently (IF NOT EXISTS / CREATE OR REPLACE) so it is a safe no-op
-- against production, which already has these objects.

-- One-time codes that let the native app exchange a web OAuth session for its
-- own Supabase session. Tokens are stored encrypted (AES-256-GCM); the plaintext
-- code is never stored, only its SHA-256 hash. Rows are single-use + short-lived.
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

-- Covers the hot lookup in consume_mobile_auth_handoff (unconsumed code by hash).
CREATE INDEX IF NOT EXISTS mobile_auth_handoffs_unconsumed_idx
  ON public.mobile_auth_handoffs USING btree (code_hash, expires_at)
  WHERE (consumed_at IS NULL);

-- Covers the user_id FK for cascade deletes.
CREATE INDEX IF NOT EXISTS idx_mobile_auth_handoffs_user_id
  ON public.mobile_auth_handoffs USING btree (user_id);

-- Service-role only. RLS on with no policies means no anon/authenticated access;
-- the consume route reaches the table exclusively through the SECURITY DEFINER
-- function below, using the service client.
ALTER TABLE public.mobile_auth_handoffs ENABLE ROW LEVEL SECURITY;

-- Atomically claim the oldest unconsumed, unexpired handoff for a code hash and
-- return its encrypted tokens. FOR UPDATE SKIP LOCKED makes concurrent consume
-- attempts race-safe; the single UPDATE guarantees one-time use.
CREATE OR REPLACE FUNCTION public.consume_mobile_auth_handoff(p_code_hash text)
  RETURNS TABLE(user_id uuid, encrypted_access_token text, encrypted_refresh_token text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
AS $function$
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
$function$;

-- This function decrypts and returns session tokens. It must only be reachable
-- via the service client (the API route), never directly by anon/authenticated
-- clients through PostgREST. Lock the grants down to service_role.
REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mobile_auth_handoff(text) TO service_role;
