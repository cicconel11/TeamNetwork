-- AI assistant pending actions
-- Generic confirmation queue for assistant write actions

CREATE TABLE ai_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'executed', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  result_entity_type text,
  result_entity_id uuid
);

CREATE INDEX idx_ai_pending_actions_user_org_status
  ON ai_pending_actions(user_id, organization_id, status);

CREATE INDEX idx_ai_pending_actions_thread
  ON ai_pending_actions(thread_id, created_at DESC);

CREATE INDEX idx_ai_pending_actions_expires
  ON ai_pending_actions(expires_at);

ALTER TABLE ai_pending_actions ENABLE ROW LEVEL SECURITY;

-- Service role owns assistant execution. End users do not query this table directly.
