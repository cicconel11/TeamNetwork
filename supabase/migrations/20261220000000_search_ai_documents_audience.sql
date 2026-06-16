-- Add optional audience scoping to the RAG vector search.
--
-- search_ai_documents previously filtered only by org + source table, so the
-- assistant could ground answers on audience-restricted chunks (e.g. alumni-only
-- announcements) for any requester. RLS only re-filters at display/hydration, not
-- in the chat-context retrieval path, so the restriction was never enforced there.
--
-- This adds p_audience_filter text[] DEFAULT NULL:
--   * NULL (default)  -> no audience filtering (admin / global callers; preserves
--                        existing behavior for every current caller).
--   * non-NULL list   -> a chunk passes only when its audience is unrestricted
--                        ('all' / 'both' / unset) or intersects the allowed list.
--
-- Drop the old 5-arg function first so we end up with exactly one definition
-- (avoids PostgREST overload ambiguity when callers pass named args).

DROP FUNCTION IF EXISTS public.search_ai_documents(
  uuid, extensions.vector, integer, double precision, text[]
);

CREATE OR REPLACE FUNCTION public.search_ai_documents(
  p_org_id uuid,
  p_query_embedding extensions.vector(768),
  p_match_count integer DEFAULT 5,
  p_similarity_threshold float DEFAULT 0.5,
  p_source_tables text[] DEFAULT NULL,
  p_audience_filter text[] DEFAULT NULL
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
    AND (
      p_audience_filter IS NULL
      OR COALESCE(c.metadata->>'audience', 'all') IN ('all', 'both')
      OR (c.metadata->>'audience') = ANY(p_audience_filter)
    )
    AND (1 - (c.embedding <=> p_query_embedding)) >= p_similarity_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.search_ai_documents IS
  'Vector similarity search across org document chunks, with optional audience scoping (p_audience_filter NULL = unrestricted).';

REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_ai_documents TO service_role;
