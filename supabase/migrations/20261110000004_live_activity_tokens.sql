-- =============================================================================
-- 20261110000004_live_activity_tokens
-- =============================================================================
-- Phase 2.1: persistence layer for iOS Live Activity push tokens.
--
-- Each row represents one Live Activity instance running on one user's device.
-- Apple's ActivityKit issues a push token per Activity.request() call; we send
-- LA `update` and `end` pushes to that token. When the activity ends (event
-- cancelled, RSVP changed away from attending, user signs out, or 24h zombie
-- expiry), `ended_at` is set so the row no longer matches dispatcher fan-out.
--
-- Constraints:
--   - One active LA per (user, event) — DB-enforced via partial unique index.
--   - Service role only; clients never read these tokens (push_token is a
--     transit-only secret).
--   - BEFORE DELETE trigger on `users` enqueues `live_activity_end` jobs for
--     all still-active activities so the device tears down cleanly before the
--     CASCADE wipes them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.live_activity_tokens (
  activity_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  push_token text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active LA per (user, event). Re-registering for the same event from a
-- second device replaces the first (mobile context is responsible for ending
-- the prior activity before requesting a new one).
CREATE UNIQUE INDEX IF NOT EXISTS live_activity_tokens_one_active_per_user_event
  ON public.live_activity_tokens (user_id, event_id) WHERE ended_at IS NULL;

-- Lookup index for the dispatcher: fan-out by event_id, only active rows.
CREATE INDEX IF NOT EXISTS live_activity_tokens_active_by_event_idx
  ON public.live_activity_tokens (event_id) WHERE ended_at IS NULL;

-- Lookup index for the sign-out path: end every active activity for this
-- (user, device).
CREATE INDEX IF NOT EXISTS live_activity_tokens_active_by_device_idx
  ON public.live_activity_tokens (user_id, device_id) WHERE ended_at IS NULL;

ALTER TABLE public.live_activity_tokens ENABLE ROW LEVEL SECURITY;

-- Service-role only; clients must go through /api/live-activity/{register,
-- unregister} so we can attribute the activity to an authenticated user and
-- gate by org membership. No SELECT/INSERT/UPDATE/DELETE policies = locked
-- down to the service key.
DROP POLICY IF EXISTS live_activity_tokens_service_only ON public.live_activity_tokens;

-- Updated_at touch trigger.
CREATE OR REPLACE FUNCTION public.tg_live_activity_tokens_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS live_activity_tokens_updated_at ON public.live_activity_tokens;
CREATE TRIGGER live_activity_tokens_updated_at
  BEFORE UPDATE ON public.live_activity_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_live_activity_tokens_updated_at();

-- BEFORE DELETE on users: fire `live_activity_end` jobs for every still-active
-- activity so the device tears the LA down before the CASCADE cleans the row.
-- Without this, a deleted user's iPhone would keep showing the LA until APNs
-- naturally times it out (up to 12h).
CREATE OR REPLACE FUNCTION public.tg_users_before_delete_end_live_activities()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_la record;
BEGIN
  FOR active_la IN
    SELECT activity_id, event_id, organization_id
    FROM public.live_activity_tokens
    WHERE user_id = OLD.id
      AND ended_at IS NULL
  LOOP
    INSERT INTO public.notification_jobs (
      organization_id,
      kind,
      priority,
      title,
      body,
      data,
      status,
      scheduled_for
    ) VALUES (
      active_la.organization_id,
      'live_activity_end',
      10,
      NULL,
      NULL,
      jsonb_build_object(
        'event_id', active_la.event_id,
        'activity_id', active_la.activity_id,
        'reason', 'user_deleted',
        'dismissal_date', extract(epoch from now())::int,
        'content_state', '{}'::jsonb
      ),
      'pending',
      now()
    );
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS users_before_delete_end_live_activities ON public.users;
CREATE TRIGGER users_before_delete_end_live_activities
  BEFORE DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_users_before_delete_end_live_activities();

COMMENT ON TABLE public.live_activity_tokens IS
  'iOS Live Activity push tokens. One active row per (user, event). Service-role only; never expose push_token to clients.';
COMMENT ON COLUMN public.live_activity_tokens.activity_id IS
  'ActivityKit-issued identifier for the running Activity. Stable across app launches.';
COMMENT ON COLUMN public.live_activity_tokens.push_token IS
  'APNs push token bound to this Activity. Sensitive — never expose to clients.';
COMMENT ON COLUMN public.live_activity_tokens.ends_at IS
  'When this Activity will auto-expire on-device. Used as a soft hint for cleanup; APNs ultimately decides.';
