-- Migration: Add service role bypass policies to enterprise tables
--
-- Problem: Enterprise API routes return 404 because RLS policies check auth.uid()
-- which is NULL when using service role. This blocks legitimate server-side queries.
--
-- Solution: Add service role bypass policies following the pattern already used
-- for enterprise_invites table.

-- Service role bypass for enterprises table
DROP POLICY IF EXISTS enterprises_service_all ON public.enterprises;
CREATE POLICY enterprises_service_all ON public.enterprises
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Service role bypass for enterprise_subscriptions table
DROP POLICY IF EXISTS enterprise_subscriptions_service_all ON public.enterprise_subscriptions;
CREATE POLICY enterprise_subscriptions_service_all ON public.enterprise_subscriptions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Service role bypass for enterprise_adoption_requests table
DROP POLICY IF EXISTS enterprise_adoption_requests_service_all ON public.enterprise_adoption_requests;
CREATE POLICY enterprise_adoption_requests_service_all ON public.enterprise_adoption_requests
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Service role bypass for user_enterprise_roles table
DROP POLICY IF EXISTS user_enterprise_roles_service_all ON public.user_enterprise_roles;
CREATE POLICY user_enterprise_roles_service_all ON public.user_enterprise_roles
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
