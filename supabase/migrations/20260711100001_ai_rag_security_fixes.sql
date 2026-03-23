-- RAG security fixes from code review
-- Issue 1: Revoke authenticated access to search_ai_documents (cross-org risk)
-- Issue 7: Fix purge to only delete completed/dead-letter items

-- Issue 1: search_ai_documents should be service-role only
-- The RPC is only called from rag-retriever.ts via service client
REVOKE EXECUTE ON FUNCTION public.search_ai_documents FROM authenticated;

-- Issue 7: purge should not delete unprocessed backlog items
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

REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_ai_embedding_queue FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ai_embedding_queue TO service_role;
