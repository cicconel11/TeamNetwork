-- knowledge_documents — org-curated knowledge base as an 8th RAG source.
--
-- Adds an admin-managed table whose rows flow through the existing
-- source-agnostic embedding pipeline (trigger -> queue -> worker -> chunks).
-- Audience gating reuses the same metadata->>'audience' contract enforced by
-- search_ai_documents (see 20261220000000_search_ai_documents_audience.sql):
--   * 'all' (default) / 'both' / unset  -> visible to every role.
--   * 'admins'                          -> a token absent from every non-admin
--                                          audienceFilterForRole() allowlist, so
--                                          only admins (who pass NULL = no filter)
--                                          can retrieve it.
--
-- Timing-safe vs the separate CHECK-sync PR: the source_table CHECK is rebuilt
-- idempotently (DROP IF EXISTS + re-ADD with all 8 tables), so this migration is
-- correct whether the live constraint listed 5 or 7 tables beforehand.

-- =============================================================================
-- 1. knowledge_documents table
-- =============================================================================

CREATE TABLE public.knowledge_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type             text,
  title            text NOT NULL,
  description      text,
  resource         text,
  tags             text[],
  body             text NOT NULL,
  audience         text NOT NULL DEFAULT 'all',
  source_timestamp timestamptz,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE public.knowledge_documents IS 'Admin-curated org knowledge base; indexed for RAG via the ai_embedding_queue pipeline';
COMMENT ON COLUMN public.knowledge_documents.audience IS 'Audience gating token surfaced into chunk metadata. ''all''/''both''/unset = visible to all; ''admins'' = admin-only (absent from every non-admin allowlist)';
COMMENT ON COLUMN public.knowledge_documents.resource IS 'Optional link/reference to a source document or external resource';

-- Org-scoped lookup of live rows (backfill + admin listing)
CREATE INDEX idx_knowledge_documents_org
  ON public.knowledge_documents(organization_id)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- 2. RLS — admin-managed, mirroring ai_indexing_exclusions_admin
-- =============================================================================

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "knowledge_documents_admin"
  ON public.knowledge_documents
  FOR ALL
  USING (
    has_active_role(organization_id, array['admin'])
  )
  WITH CHECK (
    has_active_role(organization_id, array['admin'])
  );

-- =============================================================================
-- 3. updated_at maintenance (reuses shared trigger fn)
-- =============================================================================

CREATE TRIGGER trg_knowledge_documents_updated_at
  BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 4. Idempotent source_table CHECK rebuild on ai_document_chunks (all 8 tables)
-- =============================================================================

ALTER TABLE public.ai_document_chunks
  DROP CONSTRAINT IF EXISTS ai_document_chunks_source_table_check;

ALTER TABLE public.ai_document_chunks
  ADD CONSTRAINT ai_document_chunks_source_table_check
  CHECK (source_table IN (
    'announcements', 'discussion_threads', 'discussion_replies',
    'events', 'job_postings', 'mentor_profiles', 'form_submissions',
    'knowledge_documents'
  ));

-- =============================================================================
-- 5. enqueue_ai_embedding() — add a knowledge_documents change-detection branch
--
-- Recreated from the 20260807000000 source-table-aware version so a new table is
-- handled without referencing fields it lacks. INSERTs and meaningful UPDATEs
-- still enqueue; the new branch skips no-op UPDATEs for knowledge_documents.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enqueue_ai_embedding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Soft-delete: deleted_at changed from NULL to non-NULL.
  IF TG_OP = 'UPDATE'
     AND NEW.deleted_at IS NOT NULL
     AND OLD.deleted_at IS NULL
  THEN
    INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
    VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'delete')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  -- Skip updates where deleted_at is already set.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- For UPDATE: only enqueue if indexed content for this source table changed.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'announcements' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.body IS NOT DISTINCT FROM OLD.body
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience
         AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'events' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.description IS NOT DISTINCT FROM OLD.description
         AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
         AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
         AND NEW.location IS NOT DISTINCT FROM OLD.location
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'discussion_threads' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.body IS NOT DISTINCT FROM OLD.body
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'discussion_replies' THEN
      IF NEW.body IS NOT DISTINCT FROM OLD.body
         AND NEW.thread_id IS NOT DISTINCT FROM OLD.thread_id
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'job_postings' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.company IS NOT DISTINCT FROM OLD.company
         AND NEW.description IS NOT DISTINCT FROM OLD.description
         AND NEW.location IS NOT DISTINCT FROM OLD.location
         AND NEW.location_type IS NOT DISTINCT FROM OLD.location_type
      THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'knowledge_documents' THEN
      IF NEW.title IS NOT DISTINCT FROM OLD.title
         AND NEW.body IS NOT DISTINCT FROM OLD.body
         AND NEW.description IS NOT DISTINCT FROM OLD.description
         AND NEW.type IS NOT DISTINCT FROM OLD.type
         AND NEW.tags IS NOT DISTINCT FROM OLD.tags
         AND NEW.audience IS NOT DISTINCT FROM OLD.audience
      THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  VALUES (NEW.organization_id, TG_TABLE_NAME, NEW.id, 'upsert')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_ai_embedding() IS 'Trigger function: enqueues embedding work only when source-table-specific indexed content changes';

-- =============================================================================
-- 6. Embedding trigger on knowledge_documents
-- =============================================================================

CREATE TRIGGER trg_ai_embed_knowledge_documents
  AFTER INSERT OR UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_ai_embedding();

-- =============================================================================
-- 7. backfill_ai_embedding_queue() — add a knowledge_documents scan block
--
-- Recreated from the latest hardened version (20260712000000) plus a new block.
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

  INSERT INTO public.ai_embedding_queue(org_id, source_table, source_id, action)
  SELECT p_org_id, 'knowledge_documents', kd.id, 'upsert'
  FROM public.knowledge_documents kd
  WHERE kd.organization_id = p_org_id
    AND kd.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.ai_document_chunks c
      WHERE c.org_id = p_org_id AND c.source_table = 'knowledge_documents'
        AND c.source_id = kd.id AND c.deleted_at IS NULL
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  total_enqueued := total_enqueued + batch_count;

  RETURN jsonb_build_object('enqueued', total_enqueued);
END;
$$;
