alter type public.event_type add value if not exists 'practice';
alter type public.event_type add value if not exists 'workout';

alter table public.calendar_sync_preferences
  add column if not exists sync_practice boolean default true,
  add column if not exists sync_workout boolean default true;
