-- =============================================================================
-- Engagement Phase B: schema for streaks, badges, digest, and quiet hours.
-- =============================================================================
-- Adds:
--   - users.last_active_at — bumped on auth-bound activity. Drives DAU + the
--     re-engagement-sweep cron's "inactive ≥7d" gate.
--   - notification_preferences.quiet_hours_{start,end,timezone} — local-time
--     window the dispatcher must defer to. Default 21:00–07:00 in UTC; mobile
--     overrides the timezone on first launch.
--   - notification_preferences.digest_push_enabled — gates the weekly digest.
--   - notification_preferences.reengagement_push_enabled — gates the
--     re-engagement sweep so dormant users can opt out without losing other
--     transactional pushes.
--   - public.record_user_activity() RPC — debounced server-side write so any
--     authenticated client can heartbeat without RLS-policy churn.
-- =============================================================================

-- 1. users.last_active_at
alter table public.users
  add column if not exists last_active_at timestamptz;

create index if not exists users_last_active_at_idx
  on public.users (last_active_at);

comment on column public.users.last_active_at is
  'Updated by record_user_activity() on auth-bound activity. Drives DAU + reengagement cron.';

-- 2. quiet hours + new push toggles on notification_preferences
alter table public.notification_preferences
  add column if not exists quiet_hours_start time not null default '21:00',
  add column if not exists quiet_hours_end time not null default '07:00',
  add column if not exists quiet_hours_timezone text not null default 'UTC',
  add column if not exists digest_push_enabled boolean not null default true,
  add column if not exists reengagement_push_enabled boolean not null default true;

comment on column public.notification_preferences.quiet_hours_start is
  'Local-time start of the user''s do-not-disturb window. Dispatcher defers digests/re-engagement pushes during this window.';
comment on column public.notification_preferences.quiet_hours_end is
  'Local-time end of the user''s do-not-disturb window.';
comment on column public.notification_preferences.quiet_hours_timezone is
  'IANA timezone (e.g. America/New_York). Mobile sets this on first launch.';

-- 3. record_user_activity() RPC — debounced heartbeat.
-- Only writes if the existing last_active_at is NULL or older than 60s, so a
-- chatty client can call this freely without thrashing the row.
create or replace function public.record_user_activity()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  update public.users
     set last_active_at = now()
   where id = v_uid
     and (last_active_at is null or last_active_at < now() - interval '60 seconds');
end;
$$;

revoke all on function public.record_user_activity() from public;
grant execute on function public.record_user_activity() to authenticated;

comment on function public.record_user_activity() is
  'Debounced heartbeat (60s) bumping users.last_active_at for the calling user. Safe to call on every authenticated request.';
