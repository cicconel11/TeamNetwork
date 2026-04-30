-- Lock down organization billing/subscription state behind RLS.
-- Direct authenticated access is read-only and admin-scoped; all writes must go
-- through trusted server/service-role paths (Stripe webhooks, billing routes).
ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_subscriptions_admin_select ON public.organization_subscriptions;
DROP POLICY IF EXISTS organization_subscriptions_service_only ON public.organization_subscriptions;
DROP POLICY IF EXISTS organization_subscriptions_select ON public.organization_subscriptions;
DROP POLICY IF EXISTS organization_subscriptions_insert ON public.organization_subscriptions;
DROP POLICY IF EXISTS organization_subscriptions_update ON public.organization_subscriptions;
DROP POLICY IF EXISTS organization_subscriptions_delete ON public.organization_subscriptions;

CREATE POLICY organization_subscriptions_admin_select
  ON public.organization_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_organization_roles uor
      WHERE uor.organization_id = organization_subscriptions.organization_id
        AND uor.user_id = (SELECT auth.uid())
        AND uor.status = 'active'
        AND uor.role = 'admin'
    )
  );

COMMENT ON POLICY organization_subscriptions_admin_select ON public.organization_subscriptions IS
  'Org admins may read their org subscription state. Mutations are intentionally service-role only.';
