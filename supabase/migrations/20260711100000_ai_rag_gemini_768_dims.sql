-- Switch embedding dimensions from 1536 (OpenAI) to 768 (Gemini text-embedding-004)
-- The table has no data yet, so this is a safe ALTER.

-- Drop indexes that depend on the embedding column
DROP INDEX IF EXISTS idx_ai_chunks_embedding_hnsw;

-- Change column type
ALTER TABLE public.ai_document_chunks
  ALTER COLUMN embedding TYPE extensions.vector(768);

-- Recreate HNSW index with new dimensions
CREATE INDEX idx_ai_chunks_embedding_hnsw
  ON public.ai_document_chunks
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE deleted_at IS NULL;

-- Recreate search RPC with new vector dimension
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

REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM anon;
GRANT EXECUTE ON FUNCTION public.search_ai_documents TO service_role;
