-- =====================================================
-- Migration: notification_jobs queue + per-category push preferences
-- =====================================================
-- 1. Adds *_push_enabled columns to notification_preferences with origin-doc
--    defaults (announcement/chat/event_reminder = true; rest = false).
-- 2. Creates notification_jobs queue table for async push fan-out.
--    Service-role-only writes; partial index on pending; kind discriminator
--    forward-compatible with later wallet/live-activity dispatch (P3).

-- -----------------------------------------------------
-- Per-category push preferences
-- -----------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS announcement_push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chat_push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_reminder_push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workout_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS competition_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discussion_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentorship_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS donation_push_enabled boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------
-- notification_jobs queue
-- -----------------------------------------------------
-- Used by the push fan-out worker. Each row is one logical send-job that
-- expands at worker time into N device pushes. Defer to inline send for
-- single-recipient jobs; queue broadcasts.
CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Discriminator. P0 only uses 'standard'; P3 will add wallet_update,
  -- live_activity_start, live_activity_update, live_activity_end.
  kind text NOT NULL DEFAULT 'standard'
    CHECK (kind IN (
      'standard',
      'wallet_update',
      'live_activity_start',
      'live_activity_update',
      'live_activity_end'
    )),
  -- Lower numbers run first. LA updates (priority=1) jump 25k-recipient
  -- broadcasts (priority=5).
  priority smallint NOT NULL DEFAULT 5,
  audience text CHECK (audience IN (
    'all', 'active_members', 'members', 'alumni', 'parents', 'individuals'
  )),
  target_user_ids uuid[],
  category text,
  push_type text,
  push_resource_id uuid,
  title text,
  body text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  leased_at timestamptz,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK (audience IS NOT NULL OR target_user_ids IS NOT NULL OR kind <> 'standard')
);

-- Worker drain hot path: ORDER BY priority, scheduled_for WHERE status='pending'.
CREATE INDEX IF NOT EXISTS notification_jobs_pending_idx
  ON public.notification_jobs (priority, scheduled_for)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS notification_jobs_org_idx
  ON public.notification_jobs (organization_id, created_at DESC);

-- Service-role only. End-users never SELECT this table — it can contain
-- cross-tenant PII bodies. Admins read their own org's notifications via the
-- public.notifications table instead.
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
-- (No policies for authenticated/anon = denied. service_role bypasses RLS.)
