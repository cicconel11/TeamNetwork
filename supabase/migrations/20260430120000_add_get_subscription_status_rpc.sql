-- Security-definer RPC returning only non-sensitive subscription columns.
-- Prevents exposing stripe_customer_id/stripe_subscription_id to non-admin users
-- while allowing all authenticated org members to check subscription status.
-- Uses SET search_path = '' with fully qualified names per project convention
-- (see 20260107120000_security_lint_fixes.sql).
--
-- NOTE: This migration supersedes the original 3-column version.
-- The correct 5-column definition (including alumni_bucket and parents_bucket)
-- was first defined in 20260429000000_fix_parent_invite_role.sql.
-- This file is kept as a no-op / idempotent re-apply of that definition
-- to ensure the migration history records the correct schema.

DROP FUNCTION IF EXISTS public.get_subscription_status(uuid);

CREATE FUNCTION public.get_subscription_status(p_org_id uuid)
RETURNS TABLE (
  status               text,
  grace_period_ends_at timestamptz,
  current_period_end   timestamptz,
  alumni_bucket        text,
  parents_bucket       text
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
    os.alumni_bucket,
    os.parents_bucket
  FROM public.organization_subscriptions os
  WHERE os.organization_id = p_org_id
    AND public.has_active_role(p_org_id, ARRAY['admin', 'active_member', 'alumni', 'parent'])
  LIMIT 1;
$$;

-- Revoke default public access, grant only to authenticated
REVOKE EXECUTE ON FUNCTION public.get_subscription_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subscription_status(uuid) TO authenticated;
