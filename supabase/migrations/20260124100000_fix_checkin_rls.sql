-- Migration: Fix event check-in RLS vulnerability
-- Issue: event_rsvps_update policy allows users to update ALL columns on their own RSVP,
-- including checked_in_at/checked_in_by. Non-admins can self-check-in via API.
-- Solution: Create admin-only RPC + protective trigger (defense in depth).

-- 1. Create admin-only RPC for check-in operations
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
  -- Verify caller is authenticated
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get the RSVP and its organization
  SELECT er.*, e.organization_id AS event_org_id INTO v_rsvp
  FROM public.event_rsvps er
  JOIN public.events e ON e.id = er.event_id
  WHERE er.id = p_rsvp_id;

  IF v_rsvp IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'RSVP not found');
  END IF;

  -- Verify caller is an admin of the organization
  IF NOT public.is_org_admin(v_rsvp.organization_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only admins can check in attendees');
  END IF;

  IF p_undo THEN
    -- Undo check-in
    UPDATE public.event_rsvps
    SET checked_in_at = NULL, checked_in_by = NULL
    WHERE id = p_rsvp_id;
  ELSE
    -- Check-in
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

-- Grant execute permission to authenticated users (RPC checks admin status internally)
GRANT EXECUTE ON FUNCTION public.check_in_event_attendee(uuid, boolean) TO authenticated;

-- 2. Create protective trigger to block direct updates of check-in columns by non-admins
-- This is defense-in-depth in case someone bypasses the RPC
CREATE OR REPLACE FUNCTION public.protect_checkin_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If check-in columns haven't changed, allow the update
  IF (OLD.checked_in_at IS NOT DISTINCT FROM NEW.checked_in_at)
     AND (OLD.checked_in_by IS NOT DISTINCT FROM NEW.checked_in_by) THEN
    RETURN NEW;
  END IF;

  -- If caller is an admin of the organization, allow the update
  IF public.is_org_admin(NEW.organization_id) THEN
    RETURN NEW;
  END IF;

  -- Block non-admins from modifying check-in status
  RAISE EXCEPTION 'Only admins can modify check-in status' USING ERRCODE = '42501';
END;
$$;

-- Drop trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS event_rsvps_protect_checkin ON public.event_rsvps;

-- Create the trigger
CREATE TRIGGER event_rsvps_protect_checkin
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.protect_checkin_columns();

-- Add comment for documentation
COMMENT ON FUNCTION public.check_in_event_attendee(uuid, boolean) IS
  'Admin-only function to check in or undo check-in for event attendees. Returns {success: true/false, error?: string}';

COMMENT ON FUNCTION public.protect_checkin_columns() IS
  'Trigger function to prevent non-admins from directly updating checked_in_at/checked_in_by columns';
