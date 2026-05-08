-- =====================================================
-- Migration: events_with_user_rsvp — add time window
-- =====================================================
-- The original RPC (20261110000000) returned every non-deleted event for an
-- org ordered by start_date ASC. With a default `p_limit` of 50 and no time
-- filter, orgs with >50 historical events filled page 1 entirely with past
-- events, and the home screen's client-side `>= now` filter then dropped
-- them all — making upcoming events disappear.
--
-- This migration adds an optional `p_from` window (defaults to `now()`) and
-- a `p_include_past` escape hatch. Default behavior now returns only events
-- whose end (or start, when end is null) is at or after the cutoff, which
-- is what every current caller actually wants.
--
-- Existing positional calls `(p_org_id, p_limit, p_offset)` keep working;
-- the two new params have defaults.
--
-- We DROP the old 3-arg signature first because CREATE OR REPLACE only
-- replaces functions with an identical argument list. Adding the two new
-- params changes the signature, so without the drop both the old and new
-- function would coexist and PostgREST `rpc()` calls passing only the
-- original three named params would resolve ambiguously.

DROP FUNCTION IF EXISTS public.events_with_user_rsvp(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.events_with_user_rsvp(
  p_org_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_from timestamptz DEFAULT NULL,
  p_include_past boolean DEFAULT false
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
  v_cutoff timestamptz := COALESCE(p_from, now());
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
    AND (
      p_include_past
      OR COALESCE(e.end_date, e.start_date) >= v_cutoff
    )
  ORDER BY e.start_date ASC
  LIMIT GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

COMMENT ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer, timestamptz, boolean) IS
  'Returns events for an org plus the caller''s RSVP status and total attending count. Defaults to upcoming-only (end_date or start_date >= now). Pass p_include_past=true to return historical events. Membership enforced via has_active_role().';

REVOKE ALL ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.events_with_user_rsvp(uuid, integer, integer, timestamptz, boolean)
  TO authenticated, service_role;
