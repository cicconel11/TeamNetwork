-- AI Assistant tables
-- Plan 1: Foundations — threads, messages, audit log

-- Threads: conversation scoped to user + org + surface
CREATE TABLE ai_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title       text,
  surface     text NOT NULL DEFAULT 'general'
              CHECK (surface IN ('general', 'members', 'analytics', 'events')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX idx_ai_threads_user_org ON ai_threads(user_id, org_id)
  WHERE deleted_at IS NULL;

-- Messages: each turn in a thread
CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text,
  intent          text,
  tool_calls      jsonb,
  status          text NOT NULL DEFAULT 'complete'
                  CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Enforce valid role/status/content combinations at DB level
  CONSTRAINT chk_message_content CHECK (
    CASE
      WHEN role = 'user' THEN content IS NOT NULL AND status = 'complete'
      WHEN role = 'assistant' AND status = 'complete' THEN content IS NOT NULL
      WHEN role = 'assistant' AND status IN ('pending', 'streaming', 'error') THEN TRUE
      WHEN role = 'system' THEN content IS NOT NULL AND status = 'complete'
      ELSE FALSE
    END
  )
);

CREATE INDEX idx_ai_messages_thread ON ai_messages(thread_id, created_at);
CREATE UNIQUE INDEX idx_ai_messages_idempotency
  ON ai_messages(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Audit log: every AI request logged (service-role insert only)
CREATE TABLE ai_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid REFERENCES ai_threads(id) ON DELETE SET NULL,
  message_id      uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  user_id         uuid NOT NULL,
  org_id          uuid NOT NULL,
  intent          text,
  tool_calls      jsonb,
  latency_ms      int,
  model           text,
  input_tokens    int,
  output_tokens   int,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '90 days'
);

CREATE INDEX idx_ai_audit_log_expires ON ai_audit_log(expires_at);

-- ═══════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════

ALTER TABLE ai_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_audit_log ENABLE ROW LEVEL SECURITY;

-- Threads: users can only access their own non-deleted threads
CREATE POLICY "Users can select own threads"
  ON ai_threads FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY "Users can insert own threads"
  ON ai_threads FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own threads"
  ON ai_threads FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Messages: access via thread ownership
CREATE POLICY "Users can select messages in own threads"
  ON ai_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.user_id = auth.uid()
        AND ai_threads.deleted_at IS NULL
    )
  );

CREATE POLICY "Users can insert messages in own threads"
  ON ai_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.user_id = auth.uid()
        AND ai_threads.deleted_at IS NULL
    )
  );

CREATE POLICY "Users can update messages in own threads"
  ON ai_messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.user_id = auth.uid()
        AND ai_threads.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.user_id = auth.uid()
        AND ai_threads.deleted_at IS NULL
    )
  );

-- Audit log: service-role only (service_role bypasses RLS entirely).
-- No policies = authenticated/anon users cannot SELECT, INSERT, UPDATE, or DELETE.
-- Service client uses service_role key which bypasses RLS, so no policy needed.
