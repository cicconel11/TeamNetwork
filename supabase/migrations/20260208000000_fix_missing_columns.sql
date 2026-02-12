-- Fix: re-apply columns that may be missing on deployed databases.
--
-- 1) target_calendar_id on user_calendar_connections
--    Original migration 20260501100000 has a future timestamp so may not
--    have been applied yet on all environments.
--
-- 2) sync-stats columns on schedule_sources
--    Original migration 20260207000000 ran before the CREATE TABLE
--    (20260422) on fresh databases, so the ALTER silently failed.
--
-- All statements use IF NOT EXISTS so this is safe to run repeatedly.

-- Ensure target_calendar_id exists on user_calendar_connections
-- Guarded: table may not exist yet on fresh databases (created by a later migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_calendar_connections') THEN
    ALTER TABLE public.user_calendar_connections
      ADD COLUMN IF NOT EXISTS target_calendar_id text NOT NULL DEFAULT 'primary';
  END IF;
END $$;

-- Ensure sync stats columns exist on schedule_sources
-- Guarded: table may not exist yet on fresh databases (created by a later migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedule_sources') THEN
    ALTER TABLE public.schedule_sources
      ADD COLUMN IF NOT EXISTS last_event_count integer,
      ADD COLUMN IF NOT EXISTS last_imported integer,
      ADD COLUMN IF NOT EXISTS last_updated integer,
      ADD COLUMN IF NOT EXISTS last_cancelled integer;
  END IF;
END $$;
