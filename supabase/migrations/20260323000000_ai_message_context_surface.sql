-- Persist the effective surface used for each AI turn without mutating thread scope.

ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS context_surface text
  CHECK (context_surface IN ('general', 'members', 'analytics', 'events'));

UPDATE public.ai_messages AS message
SET context_surface = thread.surface
FROM public.ai_threads AS thread
WHERE thread.id = message.thread_id
  AND message.context_surface IS NULL;

DROP FUNCTION IF EXISTS public.init_ai_chat(uuid, uuid, text, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.init_ai_chat(
  p_user_id uuid,
  p_org_id uuid,
  p_surface text,
  p_title text,
  p_message text,
  p_idempotency_key text,
  p_thread_id uuid DEFAULT NULL,
  p_intent text DEFAULT NULL,
  p_context_surface text DEFAULT NULL
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
  IF p_thread_id IS NULL THEN
    INSERT INTO public.ai_threads(user_id, org_id, surface, title)
    VALUES (p_user_id, p_org_id, p_surface, p_title)
    RETURNING id INTO v_thread_id;
  ELSE
    v_thread_id := p_thread_id;
    UPDATE public.ai_threads SET updated_at = now() WHERE id = v_thread_id;
  END IF;

  INSERT INTO public.ai_messages(
    thread_id,
    org_id,
    user_id,
    role,
    content,
    intent,
    context_surface,
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
    COALESCE(p_context_surface, p_surface),
    'complete',
    p_idempotency_key
  )
  RETURNING id INTO v_user_msg_id;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'user_msg_id', v_user_msg_id);
END;
$$;

COMMENT ON FUNCTION public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text)
  IS 'Atomically creates/reuses thread and inserts user message';

REVOKE EXECUTE ON FUNCTION public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.init_ai_chat(uuid, uuid, text, text, text, text, uuid, text, text) TO service_role;
