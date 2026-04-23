-- AI Audit Log: output-side safety gate (Phase 1)

ALTER TABLE public.ai_audit_log
  ADD COLUMN IF NOT EXISTS safety_verdict     text,
  ADD COLUMN IF NOT EXISTS safety_categories  jsonb,
  ADD COLUMN IF NOT EXISTS safety_latency_ms  integer;

COMMENT ON COLUMN public.ai_audit_log.safety_verdict     IS 'Output safety classifier verdict: safe | controversial | unsafe';
COMMENT ON COLUMN public.ai_audit_log.safety_categories  IS 'Detected categories (pii_email, profanity, toxicity, etc.)';
COMMENT ON COLUMN public.ai_audit_log.safety_latency_ms  IS 'Classifier latency (primitives + optional LLM judge)';
