-- Performance: scope service-role-only RLS policies to the service_role instead
-- of PUBLIC. Each of these policies is permissive with USING/CHECK of just
-- `auth.role() = 'service_role'`, but was applied to PUBLIC (all roles). That
-- means every anon/authenticated query on these tables evaluated an always-false
-- extra policy branch per row, and tripped the Supabase advisor's
-- multiple_permissive_policies warning.
--
-- Re-scoping to service_role is behavior-preserving:
--   * service_role keeps the exact same policy (and bypasses RLS regardless), and
--   * anon/authenticated never matched the service_role check anyway, so their
--     access is unchanged — they simply stop evaluating a dead branch.
--
-- ALTER POLICY ... TO service_role changes only the applicable roles; the
-- USING/WITH CHECK expressions are left intact.

alter policy alumni_external_ids_service_role on public.alumni_external_ids to service_role;
alter policy service_role_only on public.analytics_events to service_role;
alter policy service_role_only on public.analytics_ops_events to service_role;
alter policy dev_admin_audit_logs_service_write on public.dev_admin_audit_logs to service_role;
alter policy dsr_requests_service_only on public.dsr_requests to service_role;
alter policy enterprise_adoption_requests_service_all on public.enterprise_adoption_requests to service_role;
alter policy enterprise_audit_logs_service_only on public.enterprise_audit_logs to service_role;
alter policy enterprise_deletion_requests_service_only on public.enterprise_deletion_requests to service_role;
alter policy enterprise_invites_service_all on public.enterprise_invites to service_role;
alter policy enterprise_subscriptions_service_all on public.enterprise_subscriptions to service_role;
alter policy enterprises_service_all on public.enterprises to service_role;
alter policy integration_sync_log_service_role on public.integration_sync_log to service_role;
alter policy service_role_only on public.ops_events to service_role;
alter policy oauth_state_service_role on public.org_integration_oauth_state to service_role;
alter policy org_integrations_service_role on public.org_integrations to service_role;
alter policy payment_attempts_service_only on public.payment_attempts to service_role;
alter policy service_role_only on public.rate_limit_analytics to service_role;
alter policy service_role_only on public.schedule_allowed_domains to service_role;
alter policy service_role_only on public.schedule_domain_rules to service_role;
alter policy stripe_events_service_only on public.stripe_events to service_role;
alter policy service_role_only on public.usage_events to service_role;
alter policy service_role_only on public.usage_summaries to service_role;
alter policy user_enterprise_roles_service_all on public.user_enterprise_roles to service_role;
