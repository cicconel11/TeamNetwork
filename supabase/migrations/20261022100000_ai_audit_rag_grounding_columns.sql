-- AI Audit Log: freeform / RAG grounding validator (Phase 2)

ALTER TABLE public.ai_audit_log
  ADD COLUMN IF NOT EXISTS rag_grounded              boolean,
  ADD COLUMN IF NOT EXISTS rag_grounding_failures    jsonb,
  ADD COLUMN IF NOT EXISTS rag_grounding_latency_ms  integer,
  ADD COLUMN IF NOT EXISTS rag_grounding_mode        text;

COMMENT ON COLUMN public.ai_audit_log.rag_grounded              IS 'True if freeform response claims were covered by retrieved chunks';
COMMENT ON COLUMN public.ai_audit_log.rag_grounding_failures    IS 'Uncovered claim snippets (redacted, capped at 20)';
COMMENT ON COLUMN public.ai_audit_log.rag_grounding_latency_ms  IS 'Validator latency (primitives + optional LLM judge)';
COMMENT ON COLUMN public.ai_audit_log.rag_grounding_mode        IS 'shadow | overwrite | block | bypass';
