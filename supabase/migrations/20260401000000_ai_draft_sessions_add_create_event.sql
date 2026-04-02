-- Allow 'create_event' draft type for AI event creation flow
ALTER TABLE ai_draft_sessions
  DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check;

ALTER TABLE ai_draft_sessions
  ADD CONSTRAINT ai_draft_sessions_draft_type_check
  CHECK (draft_type IN ('create_job_posting', 'create_discussion_thread', 'create_event'));
