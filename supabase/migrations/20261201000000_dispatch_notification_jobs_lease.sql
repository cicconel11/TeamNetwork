-- Atomic batch-lease for the notification_jobs queue.
--
-- Today the cron at apps/web/src/app/api/cron/notification-dispatch/route.ts
-- does a two-step pick-then-claim that is race-safe (the UPDATE filters by
-- status='pending') but slow under contention. This RPC collapses the lease
-- into a single statement using FOR UPDATE SKIP LOCKED so concurrent workers
-- can drain the queue without blocking each other.

create or replace function public.dispatch_notification_jobs_lease(
  p_batch_size int default 50
)
returns setof public.notification_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select id
    from public.notification_jobs
    where status = 'pending'
      and scheduled_for <= now()
    order by priority asc, scheduled_for asc
    limit greatest(p_batch_size, 1)
    for update skip locked
  )
  update public.notification_jobs nj
  set status = 'processing',
      attempts = nj.attempts + 1,
      leased_at = now()
  from picked
  where nj.id = picked.id
  returning nj.*;
end;
$$;

revoke all on function public.dispatch_notification_jobs_lease(int) from public, anon, authenticated;
grant execute on function public.dispatch_notification_jobs_lease(int) to service_role;

comment on function public.dispatch_notification_jobs_lease(int) is
  'Atomically leases up to p_batch_size pending notification_jobs rows for the dispatcher cron. Service-role only.';
