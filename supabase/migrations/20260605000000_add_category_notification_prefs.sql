ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS announcement_emails_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_emails_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS workout_emails_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS competition_emails_enabled boolean NOT NULL DEFAULT true;
