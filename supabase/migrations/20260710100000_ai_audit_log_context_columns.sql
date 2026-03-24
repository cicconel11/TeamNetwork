-- Add context enrichment metadata to the AI audit log.
-- These columns track which surface was used for context selection
-- and the estimated token count of the injected context message.

ALTER TABLE ai_audit_log
  ADD COLUMN IF NOT EXISTS context_surface text,
  ADD COLUMN IF NOT EXISTS context_token_estimate integer;

COMMENT ON COLUMN ai_audit_log.context_surface IS 'Cache surface used for context selection (general, members, analytics, events)';
COMMENT ON COLUMN ai_audit_log.context_token_estimate IS 'Estimated token count of the org context message (~chars/4)';
