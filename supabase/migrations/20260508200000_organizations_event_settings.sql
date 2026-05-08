-- Per-org event configuration. Currently houses the live-activity grace
-- window so the lock-screen card can persist longer for orgs with
-- post-event check-out flows.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS event_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.event_settings IS
  'Per-org event configuration. Recognized keys: live_activity_grace_minutes (integer, default 30).';
