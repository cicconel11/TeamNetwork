-- Migration: Fix cross-org check-in bypass vulnerabilities
-- Issue 1: Users can update organization_id on their RSVP to an org where they're admin
-- Issue 2: RPC checks admin against RSVP's org, not event's org (which is authoritative)
-- Solution: Lock org_id with trigger + fix RPC/trigger to use event's org

-- 1. Block organization_id changes on event_rsvps
-- Users should never be able to change which org an RSVP belongs to
CREATE OR REPLACE FUNCTION public.protect_rsvp_org_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If organization_id hasn't changed, allow the update
  IF OLD.organization_id IS NOT DISTINCT FROM NEW.organization_id THEN
    RETURN NEW;
  END IF;

  -- Only admins of the ORIGINAL org can change organization_id (should never happen in normal use)
  IF public.is_org_admin(OLD.organization_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cannot change organization_id on RSVP' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS event_rsvps_protect_org_id ON public.event_rsvps;

CREATE TRIGGER event_rsvps_protect_org_id
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.protect_rsvp_org_id();

COMMENT ON FUNCTION public.protect_rsvp_org_id() IS
  'Prevents users from changing organization_id on their RSVPs to bypass security checks';

-- 2. Fix check_in_event_attendee to use event's org, not RSVP's org
-- The RSVP's organization_id could be tampered; event's org is authoritative
CREATE OR REPLACE FUNCTION public.check_in_event_attendee(
  p_rsvp_id uuid,
  p_undo boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rsvp record;
  v_caller_id uuid := auth.uid();
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get the RSVP and the EVENT's organization (authoritative source)
  SELECT er.*, e.organization_id AS event_org_id INTO v_rsvp
  FROM public.event_rsvps er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.id = p_rsvp_id;

  IF v_rsvp IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  -- Use event's org (not RSVP's org) for admin check
  IF NOT public.is_org_admin(v_rsvp.event_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can check in attendees');
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

-- 3. Fix trigger to also use event's org for consistency
CREATE OR REPLACE FUNCTION public.protect_checkin_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_org_id uuid;
BEGIN
  -- If check-in columns haven't changed, allow the update
  IF (OLD.checked_in_at IS NOT DISTINCT FROM NEW.checked_in_at)
     AND (OLD.checked_in_by IS NOT DISTINCT FROM NEW.checked_in_by) THEN
    RETURN NEW;
  END IF;

  -- Get the event's organization (authoritative source)
  SELECT e.organization_id INTO v_event_org_id
  FROM public.events e
  WHERE e.id = NEW.event_id;

  -- If caller is an admin of the event's organization, allow the update
  IF public.is_org_admin(v_event_org_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins can modify check-in status' USING ERRCODE = '42501';
END;
$$;
