-- Add p_skip_user_message to init_ai_chat.
--
-- When a turn is destined for a terminal refusal (message-safety block or
-- out-of-scope-unrelated scope refusal), the handler resolves that verdict
-- BEFORE the RPC runs. Previously the RPC always inserted the user message, so
-- every hard-refused message left a permanent role='user' row in conversation
-- history -- polluting threads, inflating analytics, and retaining content
-- (often the PII/jailbreak messages that were refused) that should not be
-- stored. The thread itself is still created/touched so the refusal assistant
-- row has somewhere to live; only the user-message insert is skipped.
--
-- Recreated as a single 11-param overload. Drop the prior 10-param version so
-- no stale overload remains (matches the consolidation in 20260713000000).

DROP FUNCTION IF EXISTS public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text, text);

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
  p_intent_type text DEFAULT NULL,
  p_skip_user_message boolean DEFAULT false
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

  -- Insert user message with all classification fields, unless this turn is
  -- already destined for a terminal refusal (no user row should be persisted).
  IF NOT p_skip_user_message THEN
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
  END IF;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'user_msg_id', v_user_msg_id);
END;
$$;

COMMENT ON FUNCTION public.init_ai_chat IS 'Atomically creates/reuses thread and inserts user message with intent classification; skips the user-message insert when p_skip_user_message (turn destined for terminal refusal)';

REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM anon;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM authenticated;
GRANT EXECUTE ON FUNCTION public.init_ai_chat TO service_role;
