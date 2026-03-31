ALTER TABLE ai_pending_actions
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE ai_pending_actions
  DROP CONSTRAINT IF EXISTS ai_pending_actions_status_check;

ALTER TABLE ai_pending_actions
  ADD CONSTRAINT ai_pending_actions_status_check
  CHECK (status IN ('pending', 'confirmed', 'executed', 'failed', 'cancelled', 'expired'));
