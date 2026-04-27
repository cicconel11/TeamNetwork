-- Compact AI org stats snapshot for generic get_org_stats prompts.

CREATE OR REPLACE FUNCTION public.get_org_stats_snapshot(
  p_org_id uuid
)
RETURNS TABLE (
  active_members bigint,
  alumni bigint,
  parents bigint,
  upcoming_events bigint,
  donations jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_organization_roles uor
    WHERE uor.organization_id = p_org_id
      AND uor.user_id = v_uid
      AND uor.status = 'active'::public.membership_status
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT count(*)
      FROM public.members m
      WHERE m.organization_id = p_org_id
        AND m.deleted_at IS NULL
        AND m.status = 'active'
    ) AS active_members,
    (
      SELECT count(*)
      FROM public.alumni a
      WHERE a.organization_id = p_org_id
        AND a.deleted_at IS NULL
    ) AS alumni,
    (
      SELECT count(*)
      FROM public.parents p
      WHERE p.organization_id = p_org_id
        AND p.deleted_at IS NULL
    ) AS parents,
    (
      SELECT count(*)
      FROM public.events e
      WHERE e.organization_id = p_org_id
        AND e.deleted_at IS NULL
        AND e.start_date >= now()
    ) AS upcoming_events,
    (
      SELECT jsonb_build_object(
        'total_amount_cents', ods.total_amount_cents,
        'donation_count', ods.donation_count,
        'last_donation_at', ods.last_donation_at
      )
      FROM public.organization_donation_stats ods
      WHERE ods.organization_id = p_org_id
    ) AS donations;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_stats_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_stats_snapshot(uuid) TO authenticated;
