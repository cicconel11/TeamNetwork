-- =====================================================
-- Migration: events_with_user_rsvp RPC
-- =====================================================
-- Adds a SECURITY DEFINER RPC that returns events plus the calling user's
-- RSVP status (`event_rsvps.status`) and the total `attending` count for
-- each event, in one round-trip. Used by mobile `useEvents` so the home
-- card / event list / event detail can render the correct RSVP state
-- without the dead `events.select("*")` projection that never carries
-- `user_rsvp_status` or `rsvp_count`.
--
-- Membership is enforced at the function boundary via
-- `public.has_active_role()` so admins/active_members/alumni/parents see
-- their own org's events. RLS on `events` is unchanged.

CREATE OR REPLACE FUNCTION public.events_with_user_rsvp(
  p_org_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  organization_id uuid,
  title text,
  description text,
  location text,
  start_date timestamptz,
  end_date timestamptz,
  audience text,
  event_type public.event_type,
  is_philanthropy boolean,
  recurrence_group_id uuid,
  recurrence_index integer,
  recurrence_rule jsonb,
  target_user_ids uuid[],
  created_by_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  user_rsvp_status text,
  rsvp_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (select auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_active_role(
    p_org_id,
    ARRAY['admin','active_member','alumni','parent']
  ) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.organization_id,
    e.title,
    e.description,
    e.location,
    e.start_date,
    e.end_date,
    e.audience,
    e.event_type,
    e.is_philanthropy,
    e.recurrence_group_id,
    e.recurrence_index,
    e.recurrence_rule,
    e.target_user_ids,
    e.created_by_user_id,
    e.created_at,
    e.updated_at,
    e.deleted_at,
    (
      SELECT er.status
      FROM public.event_rsvps er
      WHERE er.event_id = e.id
        AND er.user_id = v_user_id
      LIMIT 1
    ) AS user_rsvp_status,
    (
      SELECT COUNT(*)::integer
      FROM public.event_rsvps er2
      WHERE er2.event_id = e.id
        AND er2.status = 'attending'
    ) AS rsvp_count
  FROM public.events e
  WHERE e.organization_id = p_org_id
    AND e.deleted_at IS NULL
  ORDER BY e.start_date ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

COMMENT ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer) IS
  'Returns events for an org plus the caller''s RSVP status and total attending count. Membership enforced via has_active_role().';

REVOKE ALL ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer)
  TO authenticated, service_role;
