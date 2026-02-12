-- Add Google Calendar support to schedule_sources
-- connected_user_id: the user who connected their Google account (for token lookup)
-- google_calendar_id: the Google Calendar ID to sync events from

ALTER TABLE schedule_sources
  ADD COLUMN IF NOT EXISTS connected_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_calendar_id text;

COMMENT ON COLUMN schedule_sources.connected_user_id IS 'User who connected their Google account for this schedule source';
COMMENT ON COLUMN schedule_sources.google_calendar_id IS 'Google Calendar ID when vendor_id = google_calendar';
