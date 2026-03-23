-- AI RAG Foundation
-- Creates tables for document chunk storage, embedding queue, and admin indexing exclusions.
-- pgvector extension already exists (created in 20260321100001_ai_semantic_cache.sql).

-- =============================================================================
-- 1. ai_document_chunks — stores embedded content for vector similarity search
-- =============================================================================

CREATE TABLE public.ai_document_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_table    text NOT NULL
                  CHECK (source_table IN (
                    'announcements', 'discussion_threads', 'discussion_replies',
                    'events', 'job_postings'
                  )),
  source_id       uuid NOT NULL,
  chunk_index     smallint NOT NULL DEFAULT 0,
  content_text    text NOT NULL,
  content_hash    text NOT NULL,
  embedding       extensions.vector(768),
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

COMMENT ON TABLE public.ai_document_chunks IS 'Stores embedded content chunks for RAG vector similarity search';
COMMENT ON COLUMN public.ai_document_chunks.source_table IS 'Name of the source table this chunk was derived from';
COMMENT ON COLUMN public.ai_document_chunks.source_id IS 'PK of the source row in source_table';
COMMENT ON COLUMN public.ai_document_chunks.chunk_index IS '0 for single-chunk docs, increments for multi-chunk';
COMMENT ON COLUMN public.ai_document_chunks.content_text IS 'Rendered text that was embedded';
COMMENT ON COLUMN public.ai_document_chunks.content_hash IS 'SHA-256 of content_text — skip re-embedding if unchanged';
COMMENT ON COLUMN public.ai_document_chunks.embedding IS '768-dim vector from Gemini text-embedding-004';
COMMENT ON COLUMN public.ai_document_chunks.metadata IS 'Source-specific metadata (title, audience, parent_thread_id, etc.)';

-- Org-scoped lookup by source type
CREATE INDEX idx_ai_chunks_org_source
  ON public.ai_document_chunks(org_id, source_table)
  WHERE deleted_at IS NULL;

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX idx_ai_chunks_embedding_hnsw
  ON public.ai_document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE deleted_at IS NULL;

-- Prevent duplicate chunks for the same source record
CREATE UNIQUE INDEX idx_ai_chunks_source_unique
  ON public.ai_document_chunks(org_id, source_table, source_id, chunk_index)
  WHERE deleted_at IS NULL;

-- RLS: service-role only (same pattern as ai_semantic_cache)
ALTER TABLE public.ai_document_chunks ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. ai_embedding_queue — async processing queue for embedding generation
-- =============================================================================

CREATE TABLE public.ai_embedding_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_table    text NOT NULL,
  source_id       uuid NOT NULL,
  action          text NOT NULL CHECK (action IN ('upsert', 'delete')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  error           text,
  attempts        smallint NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.ai_embedding_queue IS 'Async queue for embedding generation — populated by triggers, processed by cron';
COMMENT ON COLUMN public.ai_embedding_queue.action IS 'upsert = create/update embedding, delete = soft-delete existing chunks';
COMMENT ON COLUMN public.ai_embedding_queue.attempts IS 'Incremented on failure — items with attempts >= 3 are excluded from processing';

-- Fast lookup for pending items (excludes dead-letter items with >= 3 attempts)
CREATE INDEX idx_ai_embedding_queue_pending
  ON public.ai_embedding_queue(created_at)
  WHERE processed_at IS NULL AND attempts < 3;

-- RLS: service-role only
ALTER TABLE public.ai_embedding_queue ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. ai_indexing_exclusions — admin opt-out from indexing specific content
-- =============================================================================

CREATE TABLE public.ai_indexing_exclusions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_table    text NOT NULL,
  source_id       uuid NOT NULL,
  excluded_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, source_table, source_id)
);

COMMENT ON TABLE public.ai_indexing_exclusions IS 'Admin opt-out: excluded content is skipped during embedding generation';

ALTER TABLE public.ai_indexing_exclusions ENABLE ROW LEVEL SECURITY;

-- Org admins can manage exclusions for their org
CREATE POLICY "ai_indexing_exclusions_admin"
  ON public.ai_indexing_exclusions
  FOR ALL
  USING (
    has_active_role(org_id, array['admin'])
  )
  WITH CHECK (
    has_active_role(org_id, array['admin'])
  );
