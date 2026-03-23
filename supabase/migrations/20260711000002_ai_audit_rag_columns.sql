-- AI Audit Log: RAG observability columns

ALTER TABLE public.ai_audit_log
  ADD COLUMN rag_chunk_count    smallint,
  ADD COLUMN rag_top_similarity real,
  ADD COLUMN rag_error          text;

COMMENT ON COLUMN public.ai_audit_log.rag_chunk_count IS 'Number of RAG chunks injected into context';
COMMENT ON COLUMN public.ai_audit_log.rag_top_similarity IS 'Highest cosine similarity score among retrieved chunks';
COMMENT ON COLUMN public.ai_audit_log.rag_error IS 'Error message if RAG retrieval failed (chat continues without RAG)';
