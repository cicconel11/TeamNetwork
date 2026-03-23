-- AI RAG Hardening Migration
-- Addresses 15 issues from Codex code review: security, correctness, performance
--
-- Phase 1: RLS tightening, scoped indexes, queue locking, atomic RPCs

-- =============================================================================
-- 1.1 RLS: Add org membership check to ai_threads INSERT/UPDATE
-- Previously only checked user_id = auth.uid() — no org membership verification
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own threads" ON public.ai_threads;
CREATE POLICY "Users can insert own threads"
  ON public.ai_threads FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_organization_roles
      WHERE user_id = auth.uid()
        AND organization_id = ai_threads.org_id
        AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Users can update own threads" ON public.ai_threads;
CREATE POLICY "Users can update own threads"
  ON public.ai_threads FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_organization_roles
      WHERE user_id = auth.uid()
        AND organization_id = ai_threads.org_id
        AND deleted_at IS NULL
    )
  );

-- =============================================================================
-- 1.2 Scope idempotency key uniqueness to (org_id, user_id)
-- Global unique index risked cross-tenant collisions
-- =============================================================================

DROP INDEX IF EXISTS idx_ai_messages_idempotency;
CREATE UNIQUE INDEX idx_ai_messages_idempotency_scoped
  ON public.ai_messages(org_id, user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =============================================================================
-- 1.3 Queue lease RPC with FOR UPDATE SKIP LOCKED
-- Prevents concurrent cron workers from double-processing
-- Items are marked processed_at = now() at dequeue; cleared on failure
-- =============================================================================

CREATE OR REPLACE FUNCTION public.dequeue_ai_embeddings(p_batch_size int DEFAULT 50)
RETURNS SETOF public.ai_embedding_queue
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.ai_embedding_queue
  SET processed_at = now()
  WHERE id IN (
    SELECT id FROM public.ai_embedding_queue
    WHERE processed_at IS NULL AND attempts < 3
    ORDER BY created_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

COMMENT ON FUNCTION public.dequeue_ai_embeddings IS 'Atomically dequeue embedding queue items with row-level locking';

REVOKE EXECUTE ON FUNCTION public.dequeue_ai_embeddings FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dequeue_ai_embeddings FROM anon;
REVOKE EXECUTE ON FUNCTION public.dequeue_ai_embeddings FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_ai_embeddings TO service_role;

-- =============================================================================
-- 1.4 Queue dedupe partial unique index
-- Prevents duplicate pending rows for the same source item
-- =============================================================================

CREATE UNIQUE INDEX idx_ai_embedding_queue_pending_dedupe
  ON public.ai_embedding_queue(org_id, source_table, source_id)
  WHERE processed_at IS NULL;

-- =============================================================================
-- 1.5 Trigger: only enqueue on meaningful content changes
-- Previously every UPDATE enqueued embeddings, even irrelevant field changes
-- Also adds ON CONFLICT DO NOTHING for the new dedupe index
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Soft-delete: deleted_at changed from NULL to non-NULL
  IF TG_OP = 'UPDATE'
     AND NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL
  THEN
    INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
    VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'delete')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Skip updates where deleted_at is already set
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATE: only enqueue if content-relevant columns actually changed
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.title IS NOT DISTINCT FROM OLD.title)
       AND (COALESCE(NEW.body, '') IS NOT DISTINCT FROM COALESCE(OLD.body, ''))
       AND (COALESCE(NEW.description, '') IS NOT DISTINCT FROM COALESCE(OLD.description, ''))
       AND (NEW.audience IS NOT DISTINCT FROM OLD.audience)
    THEN
      RETURN NEW; -- No meaningful change, skip
    END IF;
  END IF;

  -- INSERT or meaningful UPDATE — enqueue upsert
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding() IS 'Trigger function: enqueues embedding work only on meaningful content changes';

-- =============================================================================
-- 1.6 Atomic chunk replacement RPC
-- Replaces non-atomic soft-delete + individual INSERT loop
-- Both operations in one transaction — all or nothing
-- =============================================================================

CREATE OR REPLACE FUNCTION public.replace_ai_chunks(
  p_org_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_chunks jsonb  -- array of {chunk_index, content_text, content_hash, embedding, metadata}
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Soft-delete existing chunks
  UPDATE public.ai_document_chunks
  SET deleted_at = now()
  WHERE org_id = p_org_id
    AND source_table = p_source_table
    AND source_id = p_source_id
    AND deleted_at IS NULL;

  -- Insert new chunks
  INSERT INTO public.ai_document_chunks
    (org_id, source_table, source_id, chunk_index, content_text, content_hash, embedding, metadata)
  SELECT
    p_org_id,
    p_source_table,
    p_source_id,
    (c->>'chunk_index')::smallint,
    c->>'content_text',
    c->>'content_hash',
    (c->>'embedding')::extensions.vector,
    (c->'metadata')::jsonb
  FROM jsonb_array_elements(p_chunks) AS c;
END;
$$;

COMMENT ON FUNCTION public.replace_ai_chunks IS 'Atomically replaces all chunks for a source record (soft-delete old + insert new)';

REVOKE EXECUTE ON FUNCTION public.replace_ai_chunks FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_ai_chunks FROM anon;
REVOKE EXECUTE ON FUNCTION public.replace_ai_chunks FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_ai_chunks TO service_role;

-- =============================================================================
-- 2.4 Atomic retry increment RPC
-- Replaces read-modify-write pattern that was race-prone
-- Also clears processed_at to re-enqueue for retry
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_ai_queue_attempts(
  p_id uuid,
  p_error text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.ai_embedding_queue
  SET attempts = attempts + 1,
      error = left(p_error, 500),
      processed_at = NULL
  WHERE id = p_id;
$$;

COMMENT ON FUNCTION public.increment_ai_queue_attempts IS 'Atomically increment attempts and re-enqueue for retry';

REVOKE EXECUTE ON FUNCTION public.increment_ai_queue_attempts FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_ai_queue_attempts FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_ai_queue_attempts FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ai_queue_attempts TO service_role;

-- =============================================================================
-- 3.2 Transactional chat init RPC
-- Replaces separate thread creation + user message insert + thread touch
-- =============================================================================

CREATE OR REPLACE FUNCTION public.init_ai_chat(
  p_user_id uuid,
  p_org_id uuid,
  p_surface text,
  p_title text,
  p_message text,
  p_idempotency_key text,
  p_thread_id uuid DEFAULT NULL
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

  -- Insert user message
  INSERT INTO public.ai_messages(thread_id, org_id, user_id, role, content, status, idempotency_key)
  VALUES (v_thread_id, p_org_id, p_user_id, 'user', p_message, 'complete', p_idempotency_key)
  RETURNING id INTO v_user_msg_id;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'user_msg_id', v_user_msg_id);
END;
$$;

COMMENT ON FUNCTION public.init_ai_chat IS 'Atomically creates/reuses thread and inserts user message';

REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM anon;
REVOKE EXECUTE ON FUNCTION public.init_ai_chat FROM authenticated;
GRANT EXECUTE ON FUNCTION public.init_ai_chat TO service_role;

-- =============================================================================
-- Update backfill RPC to use ON CONFLICT DO NOTHING (for dedupe index)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.backfill_ai_embedding_queue(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_enqueued integer := 0;
  batch_count integer;
BEGIN
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'announcements', a.id, 'upsert'
  FROM public.announcements a
  WHERE a.organization_id = p_org_id
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'announcements'
        AND c.source_id = a.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'events', e.id, 'upsert'
  FROM public.events e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'events'
        AND c.source_id = e.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_threads', dt.id, 'upsert'
  FROM public.discussion_threads dt
  WHERE dt.organization_id = p_org_id
    AND dt.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'discussion_threads'
        AND c.source_id = dt.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_replies', dr.id, 'upsert'
  FROM public.discussion_replies dr
  WHERE dr.organization_id = p_org_id
    AND dr.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'discussion_replies'
        AND c.source_id = dr.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'job_postings', jp.id, 'upsert'
  FROM public.job_postings jp
  WHERE jp.organization_id = p_org_id
    AND jp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'job_postings'
        AND c.source_id = jp.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;
