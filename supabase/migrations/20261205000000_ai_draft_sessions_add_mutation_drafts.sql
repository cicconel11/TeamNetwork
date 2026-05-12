-- Allow AI update/delete draft continuations to persist across turns.
ALTER TABLE public.ai_draft_sessions
  DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check;

ALTER TABLE public.ai_draft_sessions
  ADD CONSTRAINT ai_draft_sessions_draft_type_check
  CHECK (
    draft_type IN (
      'create_announcement',
      'update_announcement',
      'delete_announcement',
      'create_job_posting',
      'update_job_posting',
      'delete_job_posting',
      'send_chat_message',
      'send_group_chat_message',
      'create_discussion_reply',
      'create_discussion_thread',
      'create_event',
      'update_event',
      'delete_event'
    )
  );
