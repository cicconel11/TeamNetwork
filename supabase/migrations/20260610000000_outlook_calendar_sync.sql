-- Migration: Outlook Calendar Sync support
-- Generalises user_calendar_connections and event_calendar_entries to be
-- provider-agnostic so both Google and Outlook (and future providers) can
-- coexist for a single user.

BEGIN;

-- ============================================================
-- 1. user_calendar_connections
-- ============================================================

-- Add provider column (defaults to 'google' so existing rows stay valid)
ALTER TABLE user_calendar_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'google'
    CHECK (provider IN ('google', 'outlook'));

-- Rename google_email → provider_email
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_calendar_connections'
      AND column_name  = 'google_email'
  ) THEN
    ALTER TABLE user_calendar_connections
      RENAME COLUMN google_email TO provider_email;
  END IF;
END;
$$;

-- Drop the old unique-on-user_id constraint (one row per user)
ALTER TABLE user_calendar_connections
  DROP CONSTRAINT IF EXISTS user_calendar_connections_user_id_key;

-- Add composite unique so each user can have one row per provider (idempotent)
DO $$ BEGIN
  ALTER TABLE user_calendar_connections
    ADD CONSTRAINT user_calendar_connections_user_id_provider_key
      UNIQUE (user_id, provider);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend the status check to include reconnect_required
ALTER TABLE user_calendar_connections
  DROP CONSTRAINT IF EXISTS user_calendar_connections_status_check;

DO $$ BEGIN
  ALTER TABLE user_calendar_connections
    ADD CONSTRAINT user_calendar_connections_status_check
      CHECK (status IN ('connected', 'disconnected', 'error', 'reconnect_required'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. event_calendar_entries
-- ============================================================

-- Add provider column
ALTER TABLE event_calendar_entries
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'google'
    CONSTRAINT event_calendar_entries_provider_check
      CHECK (provider IN ('google', 'outlook'));

-- Rename google_event_id → external_event_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'event_calendar_entries'
      AND column_name  = 'google_event_id'
  ) THEN
    ALTER TABLE event_calendar_entries
      RENAME COLUMN google_event_id TO external_event_id;
  END IF;
END;
$$;

-- Rename google_calendar_id → external_calendar_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'event_calendar_entries'
      AND column_name  = 'google_calendar_id'
  ) THEN
    ALTER TABLE event_calendar_entries
      RENAME COLUMN google_calendar_id TO external_calendar_id;
  END IF;
END;
$$;

-- Drop old unique constraint (event_id, user_id)
ALTER TABLE event_calendar_entries
  DROP CONSTRAINT IF EXISTS event_calendar_entries_event_id_user_id_key;

-- Add new composite unique including provider (idempotent)
DO $$ BEGIN
  ALTER TABLE event_calendar_entries
    ADD CONSTRAINT event_calendar_entries_event_id_user_id_provider_key
      UNIQUE (event_id, user_id, provider);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 3. calendar_sync_preferences — new event-type columns
-- ============================================================

ALTER TABLE calendar_sync_preferences
  ADD COLUMN IF NOT EXISTS sync_practice BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sync_workout  BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- 4. schedule_sources — rename google_calendar_id
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'schedule_sources'
      AND column_name  = 'google_calendar_id'
  ) THEN
    ALTER TABLE schedule_sources
      RENAME COLUMN google_calendar_id TO external_calendar_id;
  END IF;
END;
$$;

-- ============================================================
-- 5. calendar_feeds — rename google_calendar_id
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'calendar_feeds'
      AND column_name  = 'google_calendar_id'
  ) THEN
    ALTER TABLE calendar_feeds
      RENAME COLUMN google_calendar_id TO external_calendar_id;
  END IF;
END;
$$;

-- ============================================================
-- 6. Composite indexes on provider column for hot-path queries
-- ============================================================

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_user_cal_connections_user_provider
    ON public.user_calendar_connections(user_id, provider);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_event_cal_entries_event_user_provider
    ON public.event_calendar_entries(event_id, user_id, provider);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_event_cal_entries_user_provider_status
    ON public.event_calendar_entries(user_id, provider, sync_status);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
