-- =====================================================
-- Migration: Replace enterprise_alumni_counts VIEW usage with parameterized function
-- Date: 2026-10-20
-- Purpose: The VIEW joins all enterprises × orgs × subscriptions × alumni
--          with GROUP BY e.id. PostgreSQL may not push .eq("enterprise_id", X)
--          filters into the view. This function guarantees the filter is
--          applied at scan level: O(this_enterprise) not O(all_enterprises).
-- =====================================================

-- Keep the VIEW for backward compatibility (other code may reference it).
-- This function is the preferred path for application code.

CREATE OR REPLACE FUNCTION public.get_enterprise_counts(p_enterprise_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_total_alumni_count bigint;
  v_sub_org_count bigint;
  v_enterprise_managed_org_count bigint;
  v_sub_org_quantity integer;
BEGIN
  -- Count alumni across enterprise-managed orgs only
  SELECT COALESCE(COUNT(DISTINCT a.id), 0)
  INTO v_total_alumni_count
  FROM public.organizations o
  INNER JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  INNER JOIN public.alumni a
    ON a.organization_id = o.id
    AND a.deleted_at IS NULL
  WHERE o.enterprise_id = p_enterprise_id
    AND os.status = 'enterprise_managed';

  -- Count all sub-orgs and enterprise-managed sub-orgs
  SELECT
    COALESCE(COUNT(DISTINCT o.id), 0),
    COALESCE(COUNT(DISTINCT CASE WHEN os.status = 'enterprise_managed' THEN o.id END), 0)
  INTO v_sub_org_count, v_enterprise_managed_org_count
  FROM public.organizations o
  LEFT JOIN public.organization_subscriptions os
    ON os.organization_id = o.id
  WHERE o.enterprise_id = p_enterprise_id
    -- Note: organizations table has no deleted_at column;

  -- Fetch sub_org_quantity for quota info
  SELECT es.sub_org_quantity
  INTO v_sub_org_quantity
  FROM public.enterprise_subscriptions es
  WHERE es.enterprise_id = p_enterprise_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'total_alumni_count', v_total_alumni_count,
    'sub_org_count', v_sub_org_count,
    'enterprise_managed_org_count', v_enterprise_managed_org_count,
    'sub_org_quantity', v_sub_org_quantity
  );
END;
$$;

-- Lock down access: service_role only
REVOKE ALL ON FUNCTION public.get_enterprise_counts(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_enterprise_counts(uuid)
  TO service_role;
