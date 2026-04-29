-- =============================================================================
-- 20261110000003_notifications_kind_audit_column
-- =============================================================================
-- Phase 1.4: audit-log all sends (Expo + APNs) to public.notifications with a
-- canonical `kind` column so admins can debug delivery from one place.
--
-- Values mirror notification_jobs.kind (standard | live_activity_* | wallet_update)
-- but we keep this as text rather than a CHECK so adding new kinds in the future
-- (e.g. 'donation_receipt') doesn't require a schema migration.
-- =============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS notifications_kind_idx
  ON public.notifications (organization_id, kind, sent_at DESC);

COMMENT ON COLUMN public.notifications.kind IS
  'Dispatcher kind label: standard | live_activity_start | live_activity_update | live_activity_end | wallet_update. Mirrors notification_jobs.kind.';
