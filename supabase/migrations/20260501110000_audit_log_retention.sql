-- Retention policy for enterprise audit logs
-- Purges entries older than 365 days
-- Call via pg_cron or manual invocation: SELECT purge_old_enterprise_audit_logs();

create or replace function public.purge_old_enterprise_audit_logs()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.enterprise_audit_logs
  where created_at < now() - interval '365 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Revoke public access; only service_role or superuser can call
revoke execute on function public.purge_old_enterprise_audit_logs() from public;
revoke execute on function public.purge_old_enterprise_audit_logs() from anon;
revoke execute on function public.purge_old_enterprise_audit_logs() from authenticated;
