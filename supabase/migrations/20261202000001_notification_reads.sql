-- Server-side read state for notifications.
--
-- Replaces the AsyncStorage-only `notification_read_ids_*` cache used by
-- the mobile inbox. Storing read state server-side gives us:
--   * cross-device sync (mark read on web → mobile drops unread count)
--   * persistence across reinstall
--   * admin analytics (who has read what)
--
-- The mobile hook still keeps an in-memory mirror for instant UI feedback,
-- but the source of truth is this table.

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create index if not exists notification_reads_user_idx
  on public.notification_reads(user_id);

alter table public.notification_reads enable row level security;

-- Users can read/insert/delete their own read records. Admins do not need
-- to write reads; analytics queries can use a service-role client.
create policy "notification_reads_select_own"
  on public.notification_reads
  for select
  using (user_id = auth.uid());

create policy "notification_reads_insert_own"
  on public.notification_reads
  for insert
  with check (user_id = auth.uid());

create policy "notification_reads_delete_own"
  on public.notification_reads
  for delete
  using (user_id = auth.uid());
