-- =============================================================================
-- 20261110000005_event_rsvps_la_triggers
-- =============================================================================
-- Phase 3.3: trigger Live Activity push enqueue on event_rsvps and events
-- mutations.
--
-- Source of truth = `event_rsvps` for check-in / status, `events` for end_date
-- shifts and cancellations. Whenever either mutates and there's at least one
-- active LA for the affected event, we INSERT a `notification_jobs` row that
-- the dispatcher (Phase 1.3) drains and sends as an APNs liveactivity push.
--
-- ContentState shape mirrors the Swift struct in EventActivityAttributes:
--   { checkedInCount, totalAttending, isCheckedIn, status, endsAt }
--
-- We compute the aggregate counts directly in the trigger so the device
-- payload is always in sync with the DB without a separate read-fan-out
-- service. The function is `STABLE`-equivalent (it only does cheap aggregates
-- against indexed columns), so the trigger overhead per RSVP write is small.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_build_la_content_state(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_checked_in int;
  v_end_ts timestamptz;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'attending'),
    count(*) FILTER (WHERE status = 'attending' AND checked_in_at IS NOT NULL)
  INTO v_total, v_checked_in
  FROM public.event_rsvps
  WHERE event_id = p_event_id;

  SELECT coalesce(end_date, start_date + interval '2 hours')
  INTO v_end_ts
  FROM public.events
  WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'checkedInCount', coalesce(v_checked_in, 0),
    'totalAttending', coalesce(v_total, 0),
    -- isCheckedIn is per-recipient and the dispatcher will overwrite this
    -- when fanning out per-token; we emit `false` as a safe default.
    'isCheckedIn', false,
    'status', 'live',
    'endsAt', extract(epoch from coalesce(v_end_ts, now() + interval '1 hour'))::int
  );
END;
$$;

-- =============================================================================
-- Trigger 1: event_rsvps INSERT/UPDATE → live_activity_update
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_event_rsvps_enqueue_la_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_org_id uuid;
  v_active_count int;
  v_payload jsonb;
  v_started_at timestamptz;
BEGIN
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  v_org_id := COALESCE(NEW.organization_id, OLD.organization_id);

  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only enqueue if this event has at least one running LA. Skip the work
  -- otherwise so a 5,000-org event with 0 LAs doesn't pay the cost.
  SELECT count(*), min(started_at)
  INTO v_active_count, v_started_at
  FROM public.live_activity_tokens
  WHERE event_id = v_event_id AND ended_at IS NULL;

  IF v_active_count = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_payload := public.fn_build_la_content_state(v_event_id);

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
    v_org_id,
    'live_activity_update',
    10,
    NULL,
    NULL,
    jsonb_build_object(
      'event_id', v_event_id,
      'content_state', v_payload,
      -- apns-expiration: cap at the earliest started_at + 24h so retries can't
      -- outlive the activity itself (zombie mitigation).
      'apns_expiration', extract(epoch from coalesce(v_started_at, now()) + interval '24 hours')::int
    ),
    'pending',
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS event_rsvps_enqueue_la_update ON public.event_rsvps;
CREATE TRIGGER event_rsvps_enqueue_la_update
  AFTER INSERT OR UPDATE OF status, checked_in_at ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_event_rsvps_enqueue_la_update();

-- =============================================================================
-- Trigger 2: events UPDATE end_date / deleted_at → live_activity_end | _update
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_events_enqueue_la_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_count int;
  v_started_at timestamptz;
  v_payload jsonb;
  v_kind text;
BEGIN
  SELECT count(*), min(started_at)
  INTO v_active_count, v_started_at
  FROM public.live_activity_tokens
  WHERE event_id = NEW.id AND ended_at IS NULL;

  IF v_active_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Soft-delete = end the LA with an immediate dismissal date.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO public.notification_jobs (
      organization_id,
      kind,
      priority,
      data,
      status,
      scheduled_for
    ) VALUES (
      NEW.organization_id,
      'live_activity_end',
      10,
      jsonb_build_object(
        'event_id', NEW.id,
        'reason', 'event_cancelled',
        'dismissal_date', extract(epoch from now())::int,
        'content_state', jsonb_build_object(
          'checkedInCount', 0,
          'totalAttending', 0,
          'isCheckedIn', false,
          'status', 'cancelled',
          'endsAt', extract(epoch from now())::int
        ),
        'apns_expiration', extract(epoch from coalesce(v_started_at, now()) + interval '24 hours')::int
      ),
      'pending',
      now()
    );
    RETURN NEW;
  END IF;

  -- end_date shift: keep the LA running but refresh ContentState so the card
  -- re-renders the new finish time.
  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    v_kind := 'live_activity_update';
    v_payload := public.fn_build_la_content_state(NEW.id);

    INSERT INTO public.notification_jobs (
      organization_id,
      kind,
      priority,
      data,
      status,
      scheduled_for
    ) VALUES (
      NEW.organization_id,
      v_kind,
      10,
      jsonb_build_object(
        'event_id', NEW.id,
        'content_state', v_payload,
        'apns_expiration', extract(epoch from coalesce(v_started_at, now()) + interval '24 hours')::int
      ),
      'pending',
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_enqueue_la_update ON public.events;
CREATE TRIGGER events_enqueue_la_update
  AFTER UPDATE OF deleted_at, end_date, start_date ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_events_enqueue_la_update();

COMMENT ON FUNCTION public.fn_build_la_content_state(uuid) IS
  'Build the ContentState payload for a Live Activity push. Recomputes attending + checked-in tallies from event_rsvps so the device is always in sync with the DB.';
