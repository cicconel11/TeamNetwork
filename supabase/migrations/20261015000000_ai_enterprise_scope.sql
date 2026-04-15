-- =============================================================================
-- AI Enterprise Scope — Phase 1
-- =============================================================================
-- Extends the org-scoped AI assistant schema to also support enterprise scope.
-- A thread / message / audit row / cache row is EITHER org-scoped (org_id set,
-- enterprise_id NULL) OR enterprise-scoped (enterprise_id set, org_id NULL).
--
-- Codex adversarial review findings addressed:
--   [HIGH] ai_threads / ai_messages / ai_audit_log / ai_semantic_cache all have
--          org_id NOT NULL — must drop NOT NULL and add XOR check.
--   [HIGH] ai_messages composite FK (thread_id, user_id, org_id) blocks
--          enterprise inserts — rework via scope_id generated column.
--   [MED]  get_enterprise_admins cannot rely on auth.uid() (service-role
--          executor) — takes explicit p_actor_user_id and validates inside SQL.
-- =============================================================================

-- ============================================================
-- Step 1: Drop existing composite FK first (it depends on
-- idx_ai_threads_composite_key which we're about to drop)
-- ============================================================

ALTER TABLE public.ai_messages
  DROP CONSTRAINT IF EXISTS ai_messages_thread_owner_fkey;

DROP INDEX IF EXISTS public.idx_ai_threads_composite_key;

-- ============================================================
-- Step 2: ai_threads — add enterprise_id, XOR, scope_id, new FK target index
-- Split into sequential statements so scope_id's generated expression can
-- reference enterprise_id after it's committed to the catalog.
-- ============================================================

ALTER TABLE public.ai_threads
  ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.ai_threads
  ADD COLUMN IF NOT EXISTS enterprise_id uuid
    REFERENCES public.enterprises(id) ON DELETE CASCADE;

ALTER TABLE public.ai_threads
  ADD COLUMN IF NOT EXISTS scope_id uuid
    GENERATED ALWAYS AS (COALESCE(org_id, enterprise_id)) STORED;

ALTER TABLE public.ai_threads
  DROP CONSTRAINT IF EXISTS ai_threads_scope_xor,
  ADD CONSTRAINT ai_threads_scope_xor
    CHECK ((org_id IS NULL) <> (enterprise_id IS NULL));

-- Composite unique target used by the new ai_messages FK.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_threads_scope_composite_key
  ON public.ai_threads (id, user_id, scope_id);

-- Enterprise-scope lookup index (mirrors idx_ai_threads_user_org)
CREATE INDEX IF NOT EXISTS idx_ai_threads_user_enterprise
  ON public.ai_threads (user_id, enterprise_id, surface)
  WHERE enterprise_id IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- Step 3: ai_messages — add enterprise_id, XOR, scope_id, recreate FK
-- ============================================================

ALTER TABLE public.ai_messages
  ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS enterprise_id uuid
    REFERENCES public.enterprises(id) ON DELETE CASCADE;

ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS scope_id uuid
    GENERATED ALWAYS AS (COALESCE(org_id, enterprise_id)) STORED;

ALTER TABLE public.ai_messages
  DROP CONSTRAINT IF EXISTS ai_messages_scope_xor,
  ADD CONSTRAINT ai_messages_scope_xor
    CHECK ((org_id IS NULL) <> (enterprise_id IS NULL));

ALTER TABLE public.ai_messages
  ADD CONSTRAINT ai_messages_thread_owner_fkey
    FOREIGN KEY (thread_id, user_id, scope_id)
    REFERENCES public.ai_threads (id, user_id, scope_id)
    ON DELETE CASCADE;

-- Rebuild idempotency uniqueness so org + enterprise rows both dedupe correctly.
DROP INDEX IF EXISTS public.idx_ai_messages_idempotency_scoped;

CREATE UNIQUE INDEX idx_ai_messages_idempotency_scoped
  ON public.ai_messages (
    CASE WHEN enterprise_id IS NULL THEN 'org' ELSE 'enterprise' END,
    COALESCE(org_id, enterprise_id),
    user_id,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_messages_enterprise_id
  ON public.ai_messages (enterprise_id)
  WHERE enterprise_id IS NOT NULL;

-- ============================================================
-- Step 3: ai_audit_log — add enterprise_id + XOR
-- ============================================================

ALTER TABLE public.ai_audit_log
  ALTER COLUMN org_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS enterprise_id uuid
    REFERENCES public.enterprises(id) ON DELETE CASCADE;

ALTER TABLE public.ai_audit_log
  DROP CONSTRAINT IF EXISTS ai_audit_log_scope_xor,
  ADD CONSTRAINT ai_audit_log_scope_xor
    CHECK ((org_id IS NULL) <> (enterprise_id IS NULL));

CREATE INDEX IF NOT EXISTS idx_ai_audit_log_enterprise_id
  ON public.ai_audit_log (enterprise_id)
  WHERE enterprise_id IS NOT NULL;

-- ============================================================
-- Step 4: ai_semantic_cache — add enterprise_id + XOR + rebuild unique index
-- ============================================================

ALTER TABLE public.ai_semantic_cache
  ALTER COLUMN org_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS enterprise_id uuid
    REFERENCES public.enterprises(id) ON DELETE CASCADE;

ALTER TABLE public.ai_semantic_cache
  DROP CONSTRAINT IF EXISTS ai_semantic_cache_scope_xor,
  ADD CONSTRAINT ai_semantic_cache_scope_xor
    CHECK ((org_id IS NULL) <> (enterprise_id IS NULL));

-- Rebuild unique index so enterprise entries get their own scope key
DROP INDEX IF EXISTS public.idx_ai_semantic_cache_unique_key;

CREATE UNIQUE INDEX idx_ai_semantic_cache_unique_key
  ON public.ai_semantic_cache (
    CASE WHEN enterprise_id IS NULL THEN 'org' ELSE 'enterprise' END,
    COALESCE(org_id, enterprise_id),
    surface,
    permission_scope_key,
    cache_version,
    prompt_hash
  )
  WHERE invalidated_at IS NULL;

-- ============================================================
-- Step 5: RLS policies for enterprise scope
-- ============================================================

-- ai_threads: enterprise admins can access enterprise threads.
CREATE POLICY "Users can select own enterprise threads"
  ON public.ai_threads FOR SELECT
  USING (
    user_id = auth.uid()
    AND deleted_at IS NULL
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_threads.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

CREATE POLICY "Users can insert own enterprise threads"
  ON public.ai_threads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_threads.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

CREATE POLICY "Users can update own enterprise threads"
  ON public.ai_threads FOR UPDATE
  USING (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_threads.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_threads.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

-- ai_messages: messages on enterprise threads require enterprise role.
CREATE POLICY "Users can select own enterprise messages"
  ON public.ai_messages FOR SELECT
  USING (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.ai_threads t
      WHERE t.id = ai_messages.thread_id
        AND t.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_messages.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

CREATE POLICY "Users can insert own enterprise messages"
  ON public.ai_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.ai_threads t
      WHERE t.id = ai_messages.thread_id
        AND t.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_messages.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

CREATE POLICY "Users can update own enterprise messages"
  ON public.ai_messages FOR UPDATE
  USING (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.ai_threads t
      WHERE t.id = ai_messages.thread_id
        AND t.deleted_at IS NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_messages.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND enterprise_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_enterprise_roles uer
      WHERE uer.user_id = auth.uid()
        AND uer.enterprise_id = ai_messages.enterprise_id
        AND uer.role IN ('owner', 'billing_admin', 'org_admin')
    )
  );

-- ai_audit_log: no RLS changes needed — service-role-only access.
-- ai_semantic_cache: no RLS changes needed — service-role-only access.

-- ============================================================
-- Step 6: init_ai_chat_enterprise RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.init_ai_chat_enterprise(
  p_user_id uuid,
  p_enterprise_id uuid,
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
  v_has_role boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles uer
    WHERE uer.user_id = p_user_id
      AND uer.enterprise_id = p_enterprise_id
      AND uer.role IN ('owner', 'billing_admin', 'org_admin')
  ) INTO v_has_role;

  IF NOT v_has_role THEN
    RAISE EXCEPTION 'forbidden: user % is not an enterprise admin of %', p_user_id, p_enterprise_id
      USING ERRCODE = '42501';
  END IF;

  IF p_thread_id IS NULL THEN
    INSERT INTO public.ai_threads(user_id, enterprise_id, surface, title)
    VALUES (p_user_id, p_enterprise_id, p_surface, p_title)
    RETURNING id INTO v_thread_id;
  ELSE
    v_thread_id := p_thread_id;
    UPDATE public.ai_threads
      SET updated_at = now()
      WHERE id = v_thread_id
        AND enterprise_id = p_enterprise_id
        AND user_id = p_user_id;
  END IF;

  INSERT INTO public.ai_messages(
    thread_id,
    enterprise_id,
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
    p_enterprise_id,
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

COMMENT ON FUNCTION public.init_ai_chat_enterprise IS
  'Atomically creates/reuses an enterprise-scoped thread and inserts user message. Validates enterprise role before any write.';

REVOKE EXECUTE ON FUNCTION public.init_ai_chat_enterprise FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat_enterprise FROM anon;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat_enterprise FROM authenticated;
GRANT EXECUTE ON FUNCTION public.init_ai_chat_enterprise TO service_role;

-- ============================================================
-- Step 7: get_enterprise_admins RPC (service-role compatible)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_enterprise_admins(
  p_actor_user_id uuid,
  p_enterprise_id uuid
)
RETURNS TABLE (
  user_id uuid,
  email text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_role boolean;
BEGIN
  -- Defense-in-depth: verify actor is an enterprise admin before returning rows.
  -- App also checks this via getEnterpriseAiContext, but we enforce at SQL level
  -- because tools execute under service_role which bypasses RLS.
  SELECT EXISTS (
    SELECT 1 FROM public.user_enterprise_roles uer
    WHERE uer.user_id = p_actor_user_id
      AND uer.enterprise_id = p_enterprise_id
      AND uer.role IN ('owner', 'billing_admin', 'org_admin')
  ) INTO v_has_role;

  IF NOT v_has_role THEN
    RAISE EXCEPTION 'forbidden: user % is not an enterprise admin of %', p_actor_user_id, p_enterprise_id
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT uer.user_id, u.email::text, uer.role, uer.created_at
  FROM public.user_enterprise_roles uer
  JOIN auth.users u ON u.id = uer.user_id
  WHERE uer.enterprise_id = p_enterprise_id
  ORDER BY uer.role, uer.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_enterprise_admins IS
  'Returns enterprise admins. Takes explicit actor id (not auth.uid()) for service-role executor compatibility. Raises forbidden if actor lacks enterprise admin role.';

REVOKE EXECUTE ON FUNCTION public.get_enterprise_admins FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_admins FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_enterprise_admins FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_enterprise_admins TO service_role;
