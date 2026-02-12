-- Add Google Calendar import support to calendar_feeds

ALTER TABLE public.calendar_feeds
  ADD COLUMN IF NOT EXISTS connected_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;

COMMENT ON COLUMN public.calendar_feeds.connected_user_id IS 'User whose OAuth tokens are used (for provider=google)';
COMMENT ON COLUMN public.calendar_feeds.google_calendar_id IS 'Google Calendar ID to import events from';

CREATE INDEX IF NOT EXISTS calendar_feeds_connected_user_idx ON public.calendar_feeds(connected_user_id) WHERE connected_user_id IS NOT NULL;
