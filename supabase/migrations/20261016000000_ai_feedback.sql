-- AI Feedback table for tracking user satisfaction with AI responses
CREATE TABLE ai_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      text NOT NULL CHECK (rating IN ('positive', 'negative')),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(message_id, user_id)
);

COMMENT ON TABLE ai_feedback IS 'User feedback on AI assistant responses for quality tracking';
COMMENT ON COLUMN ai_feedback.rating IS 'positive = thumbs up, negative = thumbs down';
COMMENT ON COLUMN ai_feedback.comment IS 'Optional freeform user comment';

-- Indexes for common query patterns
CREATE INDEX idx_ai_feedback_message ON ai_feedback(message_id);
CREATE INDEX idx_ai_feedback_rating ON ai_feedback(rating, created_at DESC);

-- Enable RLS
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;

-- Users can only read feedback on messages in their own threads
CREATE POLICY ai_feedback_select ON ai_feedback FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_messages m
      JOIN ai_threads t ON t.id = m.thread_id
      WHERE m.id = ai_feedback.message_id
        AND t.user_id = auth.uid()
        AND t.deleted_at IS NULL
    )
  );

-- Users can only insert feedback on messages in their own threads
CREATE POLICY ai_feedback_insert ON ai_feedback FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM ai_messages m
      JOIN ai_threads t ON t.id = m.thread_id
      WHERE m.id = ai_feedback.message_id
        AND t.user_id = auth.uid()
        AND t.deleted_at IS NULL
    )
  );

-- Users can only update their own feedback
CREATE POLICY ai_feedback_update ON ai_feedback FOR UPDATE
  USING (user_id = auth.uid());

-- Users can only delete their own feedback on messages in their own threads
CREATE POLICY ai_feedback_delete ON ai_feedback FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM ai_messages m
      JOIN ai_threads t ON t.id = m.thread_id
      WHERE m.id = ai_feedback.message_id
        AND t.user_id = auth.uid()
        AND t.deleted_at IS NULL
    )
  );
