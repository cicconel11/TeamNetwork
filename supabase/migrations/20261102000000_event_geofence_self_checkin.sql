-- Event geofence + self check-in QR flow
-- - events: latitude, longitude, optional geofence
-- - self_check_in_event: member sets attending + checked_in via SECURITY DEFINER + session GUC bypass for check-in columns
-- - check_in_event_attendee: extended with optional GPS for geofence when enabled

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS latitude double precision DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS longitude double precision DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geofence_radius_m integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS geofence_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.latitude IS 'Venue latitude (WGS84) for optional geofenced check-in';
COMMENT ON COLUMN public.events.longitude IS 'Venue longitude (WGS84) for optional geofenced check-in';
COMMENT ON COLUMN public.events.geofence_radius_m IS 'Max distance from venue (meters) when geofence_enabled';
COMMENT ON COLUMN public.events.geofence_enabled IS 'When true, self and admin QR check-in must be within geofence_radius_m';

-- Great-circle distance in meters (WGS84 spherical approximation).
CREATE OR REPLACE FUNCTION public.haversine_meters(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT (
    2 * 6371008.8 * ASIN(
      LEAST(
        1::double precision,
        SQRT(
          POWER(SIN(RADIANS((lat2 - lat1) / 2)), 2)
          + COS(RADIANS(lat1)) * COS(RADIANS(lat2))
          * POWER(SIN(RADIANS((lng2 - lng1) / 2)), 2)
        )
      )
    )
  );
$$;

-- Replace check-in trigger: block non-admins from setting check-in on INSERT/UPDATE unless GUC is set by self_check_in_event RPC.
CREATE OR REPLACE FUNCTION public.protect_checkin_columns() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_org_id uuid;
BEGIN
  SELECT e.organization_id INTO v_event_org_id
  FROM public.events e
  WHERE e.id = NEW.event_id;

  IF v_event_org_id IS NULL THEN
    RAISE EXCEPTION 'Event not found for RSVP' USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.checked_in_at IS NULL AND NEW.checked_in_by IS NULL THEN
      RETURN NEW;
    END IF;

    IF current_setting('app.allow_self_event_check_in', true) = '1' THEN
      RETURN NEW;
    END IF;

    IF public.is_org_admin(v_event_org_id) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Cannot set check-in on RSVP insert' USING ERRCODE = '42501';
  END IF;

  -- UPDATE
  IF (OLD.checked_in_at IS NOT DISTINCT FROM NEW.checked_in_at)
     AND (OLD.checked_in_by IS NOT DISTINCT FROM NEW.checked_in_by) THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.allow_self_event_check_in', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF public.is_org_admin(v_event_org_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins can modify check-in status' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS event_rsvps_protect_checkin ON public.event_rsvps;

CREATE TRIGGER event_rsvps_protect_checkin
  BEFORE INSERT OR UPDATE ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_checkin_columns();

-- Drop old overload and recreate with optional lat/lng
DROP FUNCTION IF EXISTS public.check_in_event_attendee(uuid, boolean);

CREATE OR REPLACE FUNCTION public.check_in_event_attendee(
  p_rsvp_id uuid,
  p_undo boolean DEFAULT false,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rsvp record;
  v_caller_id uuid := auth.uid();
  v_dist double precision;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT
    er.*,
    e.organization_id AS event_org_id,
    e.geofence_enabled,
    e.latitude AS ev_lat,
    e.longitude AS ev_lng,
    e.geofence_radius_m
  INTO v_rsvp
  FROM public.event_rsvps er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.id = p_rsvp_id;

  IF v_rsvp IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  IF NOT public.is_org_admin(v_rsvp.event_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can check in attendees');
  END IF;

  IF NOT p_undo AND COALESCE(v_rsvp.geofence_enabled, false) THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Location required for check-in at this event');
    END IF;
    IF v_rsvp.ev_lat IS NULL OR v_rsvp.ev_lng IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Event venue coordinates are not set');
    END IF;
    v_dist := public.haversine_meters(p_lat, p_lng, v_rsvp.ev_lat, v_rsvp.ev_lng);
    IF v_dist > COALESCE(v_rsvp.geofence_radius_m, 100) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Check-in only allowed at the event location'
      );
    END IF;
  END IF;

  IF p_undo THEN
    UPDATE public.event_rsvps
    SET checked_in_at = NULL, checked_in_by = NULL
    WHERE id = p_rsvp_id;
  ELSE
    IF v_rsvp.checked_in_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Already checked in');
    END IF;
    UPDATE public.event_rsvps
    SET checked_in_at = now(), checked_in_by = v_caller_id
    WHERE id = p_rsvp_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_in_event_attendee(uuid, boolean, double precision, double precision) TO authenticated;

COMMENT ON FUNCTION public.check_in_event_attendee(uuid, boolean, double precision, double precision) IS
  'Admin check-in/undo; when event geofence_enabled, p_lat/p_lng must be within geofence_radius_m of event coordinates.';

CREATE OR REPLACE FUNCTION public.self_check_in_event(
  p_event_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event record;
  v_dist double precision;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.geofence_enabled,
    e.latitude AS ev_lat,
    e.longitude AS ev_lng,
    e.geofence_radius_m
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found');
  END IF;

  IF NOT public.has_active_role(
    v_event.organization_id,
    ARRAY['admin', 'active_member', 'alumni', 'parent']::text[]
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this organization');
  END IF;

  IF COALESCE(v_event.geofence_enabled, false) THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Location required for check-in at this event');
    END IF;
    IF v_event.ev_lat IS NULL OR v_event.ev_lng IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Event venue coordinates are not set');
    END IF;
    v_dist := public.haversine_meters(p_lat, p_lng, v_event.ev_lat, v_event.ev_lng);
    IF v_dist > COALESCE(v_event.geofence_radius_m, 100) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'You must be at the event location to check in'
      );
    END IF;
  END IF;

  PERFORM set_config('app.allow_self_event_check_in', '1', true);

  INSERT INTO public.event_rsvps (
    event_id,
    user_id,
    organization_id,
    status,
    checked_in_at,
    checked_in_by
  )
  VALUES (
    p_event_id,
    v_uid,
    v_event.organization_id,
    'attending',
    now(),
    v_uid
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = 'attending',
    checked_in_at = EXCLUDED.checked_in_at,
    checked_in_by = EXCLUDED.checked_in_by,
    updated_at = now();

  PERFORM set_config('app.allow_self_event_check_in', '0', true);

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.allow_self_event_check_in', '0', true);
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.self_check_in_event(uuid, double precision, double precision) TO authenticated;

COMMENT ON FUNCTION public.self_check_in_event(uuid, double precision, double precision) IS
  'Member scans event QR; sets RSVP to attending and records check-in. Respects optional geofence.';
