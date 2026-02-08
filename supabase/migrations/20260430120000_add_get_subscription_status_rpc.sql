-- Security-definer RPC returning only non-sensitive subscription columns.
-- Prevents exposing stripe_customer_id/stripe_subscription_id to non-admin users
-- while allowing all authenticated org members to check subscription status.
-- Uses SET search_path = '' with fully qualified names per project convention
-- (see 20260107120000_security_lint_fixes.sql).

CREATE OR REPLACE FUNCTION public.get_subscription_status(p_org_id uuid)
RETURNS TABLE (
  status text,
  grace_period_ends_at timestamptz,
  current_period_end timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    os.status,
    os.grace_period_ends_at,
    os.current_period_end
  FROM public.organization_subscriptions os
  WHERE os.organization_id = p_org_id
    AND public.has_active_role(p_org_id, ARRAY['admin', 'active_member', 'alumni'])
  LIMIT 1;
$$;

-- Revoke default public access, grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.get_subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_status(uuid) TO authenticated;
