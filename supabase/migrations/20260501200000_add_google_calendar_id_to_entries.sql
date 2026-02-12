-- Stores which Google Calendar each synced event lives on.
-- Defaults to 'primary' for existing rows (all historical events were synced
-- before target_calendar_id existed, so they're on the user's primary calendar).

ALTER TABLE public.event_calendar_entries
  ADD COLUMN IF NOT EXISTS google_calendar_id text NOT NULL DEFAULT 'primary';
