-- Add graduation tracking columns to members table
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS expected_graduation_date date,
  ADD COLUMN IF NOT EXISTS graduation_warning_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS graduated_at timestamptz;

-- Index for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_members_graduation_pending
  ON public.members (expected_graduation_date)
  WHERE graduated_at IS NULL
    AND deleted_at IS NULL
    AND expected_graduation_date IS NOT NULL;

-- Comments
COMMENT ON COLUMN public.members.expected_graduation_date IS 'Date when member is expected to graduate and transition to alumni';
COMMENT ON COLUMN public.members.graduation_warning_sent_at IS 'When the 30-day warning was sent to admins';
COMMENT ON COLUMN public.members.graduated_at IS 'When the member was transitioned to alumni';
