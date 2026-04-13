ALTER TABLE public.ai_draft_sessions
  DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check;

ALTER TABLE public.ai_draft_sessions
  ADD CONSTRAINT ai_draft_sessions_draft_type_check
  CHECK (
    draft_type IN (
      'create_announcement',
      'create_job_posting',
      'send_chat_message',
      'send_group_chat_message',
      'create_discussion_reply',
      'create_discussion_thread',
      'create_event'
    )
  );
