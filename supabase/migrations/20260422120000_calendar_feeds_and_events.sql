-- Calendar feeds and events for ICS sync

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'ics',
  feed_url text not null,
  status text not null default 'active' check (status in ('active', 'error', 'disabled')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feed_id uuid not null references public.calendar_feeds(id) on delete cascade,
  external_uid text not null,
  instance_key text not null,
  title text,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean default false,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(feed_id, instance_key)
);

create index if not exists calendar_feeds_user_id_idx on public.calendar_feeds(user_id);
create index if not exists calendar_events_user_start_idx on public.calendar_events(user_id, start_at);
create index if not exists calendar_events_feed_start_idx on public.calendar_events(feed_id, start_at);

alter table public.calendar_feeds enable row level security;
alter table public.calendar_events enable row level security;

-- RLS policies for calendar_feeds

drop policy if exists calendar_feeds_select on public.calendar_feeds;
create policy calendar_feeds_select on public.calendar_feeds
  for select
  using (auth.uid() = user_id);

drop policy if exists calendar_feeds_insert on public.calendar_feeds;
create policy calendar_feeds_insert on public.calendar_feeds
  for insert
  with check (auth.uid() = user_id);

drop policy if exists calendar_feeds_update on public.calendar_feeds;
create policy calendar_feeds_update on public.calendar_feeds
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists calendar_feeds_delete on public.calendar_feeds;
create policy calendar_feeds_delete on public.calendar_feeds
  for delete
  using (auth.uid() = user_id);

-- RLS policies for calendar_events

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select
  using (auth.uid() = user_id);

-- updated_at triggers

drop trigger if exists calendar_feeds_updated_at on public.calendar_feeds;
create trigger calendar_feeds_updated_at
  before update on public.calendar_feeds
  for each row
  execute function public.update_updated_at_column();

drop trigger if exists calendar_events_updated_at on public.calendar_events;
create trigger calendar_events_updated_at
  before update on public.calendar_events
  for each row
  execute function public.update_updated_at_column();
