-- Add target_calendar_id column to user_calendar_connections
-- Stores which Google Calendar the user wants events synced to
-- Defaults to 'primary' (the user's default Google Calendar)

alter table public.user_calendar_connections
  add column if not exists target_calendar_id text not null default 'primary';
