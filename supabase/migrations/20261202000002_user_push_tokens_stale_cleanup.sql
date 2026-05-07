-- Stale-token cleanup helper.
--
-- A device can stop using push without telling us (uninstalled app,
-- permission revoked, replaced phone). Expo eventually returns
-- DeviceNotRegistered for those tokens and our send path deletes them, but
-- only when we attempt a send. Tokens for users who never receive a push
-- accumulate forever.
--
-- This function deletes rows whose `updated_at` (refreshed on every
-- registration upsert) is older than the cutoff. Operators can call it
-- from a Supabase scheduled function or pg_cron job nightly:
--
--   select public.cleanup_stale_push_tokens(interval '90 days');

create or replace function public.cleanup_stale_push_tokens(
  p_max_age interval default interval '90 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.user_push_tokens
  where updated_at < now() - p_max_age
  returning 1 into v_deleted;

  get diagnostics v_deleted = row_count;
  return coalesce(v_deleted, 0);
end;
$$;

revoke all on function public.cleanup_stale_push_tokens(interval) from public, anon, authenticated;
