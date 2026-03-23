-- AI RAG Queue Triggers and RPC Functions
-- Trigger function to enqueue embedding work on source table changes,
-- vector similarity search RPC, and backfill RPC.

-- =============================================================================
-- 1. Trigger function — enqueues embedding work on INSERT/UPDATE
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
    VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'delete');
    RETURN NEW;
  END IF;

  -- Skip updates where deleted_at is already set (no-op for soft-deleted rows)
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- INSERT or UPDATE (content change) — enqueue upsert
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding() IS 'Trigger function: enqueues embedding work when source content changes';

-- =============================================================================
-- 2. Apply triggers to Tier 1 source tables
-- =============================================================================

CREATE TRIGGER trg_ai_embed_announcements
  AFTER INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

CREATE TRIGGER trg_ai_embed_events
  AFTER INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

CREATE TRIGGER trg_ai_embed_discussion_threads
  AFTER INSERT OR UPDATE ON public.discussion_threads
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

CREATE TRIGGER trg_ai_embed_discussion_replies
  AFTER INSERT OR UPDATE ON public.discussion_replies
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

CREATE TRIGGER trg_ai_embed_job_postings
  AFTER INSERT OR UPDATE ON public.job_postings
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

-- =============================================================================
-- 3. RPC: Vector similarity search (org-scoped)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_ai_documents(
  p_org_id uuid,
  p_query_embedding extensions.vector(768),
  p_match_count integer DEFAULT 5,
  p_similarity_threshold float DEFAULT 0.5,
  p_source_tables text[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  source_table text,
  source_id uuid,
  chunk_index smallint,
  content_text text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.source_table,
    c.source_id,
    c.chunk_index,
    c.content_text,
    c.metadata,
    (1 - (c.embedding <=> p_query_embedding))::float AS similarity
  FROM public.ai_document_chunks c
  WHERE c.org_id = p_org_id
    AND c.deleted_at IS NULL
    AND (p_source_tables IS NULL OR c.source_table = ANY(p_source_tables))
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_similarity_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.search_ai_documents IS 'Vector similarity search across org document chunks';

REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM anon;
GRANT EXECUTE ON FUNCTION public.search_ai_documents TO service_role;

-- =============================================================================
-- 4. RPC: Backfill embedding queue for an org
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
  -- Announcements
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'announcements', a.id, 'upsert'
  FROM public.announcements a
  WHERE a.organization_id = p_org_id
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'announcements'
        AND c.source_id = a.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Events
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'events', e.id, 'upsert'
  FROM public.events e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'events'
        AND c.source_id = e.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Discussion threads
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_threads', dt.id, 'upsert'
  FROM public.discussion_threads dt
  WHERE dt.organization_id = p_org_id
    AND dt.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'discussion_threads'
        AND c.source_id = dt.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Discussion replies
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'discussion_replies', dr.id, 'upsert'
  FROM public.discussion_replies dr
  WHERE dr.organization_id = p_org_id
    AND dr.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'discussion_replies'
        AND c.source_id = dr.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  -- Job postings
  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'job_postings', jp.id, 'upsert'
  FROM public.job_postings jp
  WHERE jp.organization_id = p_org_id
    AND jp.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id
        AND c.source_table = 'job_postings'
        AND c.source_id = jp.id
        AND c.deleted_at IS NULL
    );
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;

COMMENT ON FUNCTION public.backfill_ai_embedding_queue IS 'Enqueues all unindexed content for an org across all source tables';

REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_ai_embedding_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_ai_embedding_queue TO service_role;

-- =============================================================================
-- 5. RPC: Purge old embedding queue rows (dead-letter + processed)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.purge_ai_embedding_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.ai_embedding_queue
    WHERE created_at < now() - interval '7 days'
      AND (processed_at IS NOT NULL OR attempts >= 3)
    ORDER BY created_at
    LIMIT 1000
  )
  DELETE FROM public.ai_embedding_queue
  WHERE id IN (SELECT id FROM doomed);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.purge_ai_embedding_queue IS 'Removes queue rows older than 7 days (dead-letter cleanup)';

REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ai_embedding_queue TO service_role;
