-- Migration: Add user_deletion_requests table for GDPR/COPPA compliance
-- This table tracks account deletion requests with a grace period

-- Create the user_deletion_requests table
CREATE TABLE IF NOT EXISTS user_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_deletion_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for querying pending deletions (used by cron job)
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_pending
  ON user_deletion_requests(status, scheduled_deletion_at)
  WHERE status = 'pending';

-- Add index for user lookup
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_user_id
  ON user_deletion_requests(user_id);

-- Enable RLS
ALTER TABLE user_deletion_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies
-- Users can only read their own deletion request
DROP POLICY IF EXISTS "Users can view own deletion request" ON user_deletion_requests;
CREATE POLICY "Users can view own deletion request"
  ON user_deletion_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Service role can do everything (used by API routes and cron jobs)
-- Note: Service role bypasses RLS, so no explicit policy needed

-- Add comment for documentation
COMMENT ON TABLE user_deletion_requests IS 'Tracks user account deletion requests for GDPR/COPPA compliance. Uses 30-day grace period before permanent deletion.';
COMMENT ON COLUMN user_deletion_requests.status IS 'pending: awaiting deletion, completed: account deleted, cancelled: user revoked request';
COMMENT ON COLUMN user_deletion_requests.scheduled_deletion_at IS 'Date when account will be permanently deleted (30 days after request)';

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_deletion_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_deletion_requests_updated_at ON user_deletion_requests;
CREATE TRIGGER user_deletion_requests_updated_at
  BEFORE UPDATE ON user_deletion_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_user_deletion_requests_updated_at();
