-- Add alumni_bucket to get_subscription_status RPC return type.
-- alumni_bucket is non-sensitive (values like "0-250", "none") and needed by
-- getOrgContext() to compute hasAlumniAccess for sidebar/page guards.
--
-- Must DROP first because the return type signature is changing.

DROP FUNCTION IF EXISTS public.get_subscription_status(uuid);

CREATE FUNCTION public.get_subscription_status(p_org_id uuid)
RETURNS TABLE (
  status text,
  grace_period_ends_at timestamptz,
  current_period_end timestamptz,
  alumni_bucket text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    os.status,
    os.grace_period_ends_at,
    os.current_period_end,
    os.alumni_bucket
  FROM public.organization_subscriptions os
  WHERE os.organization_id = p_org_id
    AND public.has_active_role(p_org_id, ARRAY['admin', 'active_member', 'alumni'])
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_status(uuid) TO authenticated;
