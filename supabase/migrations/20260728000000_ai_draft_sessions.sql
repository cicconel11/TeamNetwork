CREATE TABLE ai_draft_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  draft_type text NOT NULL
    CHECK (draft_type IN ('create_job_posting', 'create_discussion_thread')),
  status text NOT NULL
    CHECK (status IN ('collecting_fields', 'ready_for_confirmation')),
  draft_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_fields text[] NOT NULL DEFAULT '{}',
  pending_action_id uuid REFERENCES ai_pending_actions(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_ai_draft_sessions_thread
  ON ai_draft_sessions(thread_id);

CREATE INDEX idx_ai_draft_sessions_expires
  ON ai_draft_sessions(expires_at);

ALTER TABLE ai_draft_sessions ENABLE ROW LEVEL SECURITY;
