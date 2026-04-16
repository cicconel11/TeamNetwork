-- Allow multiple pending actions per thread for batch event creation.
-- The old unique partial index enforced one pending action per thread,
-- which blocks prepare_events_batch from creating N pending actions.

DROP INDEX IF EXISTS idx_ai_pending_actions_thread_pending;

CREATE INDEX idx_ai_pending_actions_thread_pending
  ON ai_pending_actions(thread_id, created_at DESC)
  WHERE (status = 'pending');
