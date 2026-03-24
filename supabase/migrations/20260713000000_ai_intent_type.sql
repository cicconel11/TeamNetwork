-- =============================================================================
-- Add intent_type column to ai_messages and ai_audit_log
-- =============================================================================
-- Introduces a second classification axis: intent TYPE (what the user wants)
-- alongside the existing intent column (which surface to route to).
--
-- intent_type values:
--   knowledge_query  — user asks a question / seeks information
--   action_request   — user wants something done (create, delete, send, etc.)
--   navigation       — user wants to go somewhere ("show me", "open", "go to")
--   casual           — greetings, thanks, farewells
-- =============================================================================

-- 1. Add intent_type to ai_messages with CHECK constraint
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS intent_type text
  CHECK (intent_type IN ('knowledge_query', 'action_request', 'navigation', 'casual'));

-- 2. Add intent_type to ai_audit_log (no CHECK — append-only, flexible)
ALTER TABLE public.ai_audit_log
  ADD COLUMN IF NOT EXISTS intent_type text;

-- 3. Consolidate init_ai_chat into a single 10-param function
--    The hardening migration (20260712000000) accidentally created a 7-param
--    overload that dropped p_intent and p_context_surface. Drop both overloads
--    and create one clean version.
DROP FUNCTION IF EXISTS public.init_ai_chat(uuid, uuid, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.init_ai_chat(
  p_user_id uuid,
  p_org_id uuid,
  p_surface text,
  p_title text,
  p_message text,
  p_idempotency_key text,
  p_thread_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_context_surface text DEFAULT NULL,
  p_intent_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_thread_id uuid;
  v_user_msg_id uuid;
BEGIN
  -- Create or reuse thread
  IF p_thread_id IS NULL THEN
    INSERT INTO public.ai_threads(user_id, org_id, surface, title)
    VALUES (p_user_id, p_org_id, p_surface, p_title)
    RETURNING id INTO v_thread_id;
  ELSE
    v_thread_id := p_thread_id;
    UPDATE public.ai_threads SET updated_at = now() WHERE id = v_thread_id;
  END IF;

  -- Insert user message with all classification fields
  INSERT INTO public.ai_messages(
    thread_id,
    org_id,
    user_id,
    role,
    content,
    intent,
    context_surface,
    intent_type,
    status,
    idempotency_key
  )
  VALUES (
    v_thread_id,
    p_org_id,
    p_user_id,
    'user',
    p_message,
    p_intent,
    p_context_surface,
    p_intent_type,
    'complete',
    p_idempotency_key
  )
  RETURNING id INTO v_user_msg_id;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'user_msg_id', v_user_msg_id);
END;
$$;

COMMENT ON FUNCTION public.init_ai_chat IS 'Atomically creates/reuses thread and inserts user message with intent classification';

REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM anon;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM authenticated;
GRANT EXECUTE ON FUNCTION public.init_ai_chat TO service_role;
