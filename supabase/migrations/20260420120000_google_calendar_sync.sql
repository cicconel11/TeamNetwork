-- Google Calendar Sync tables for automatic event synchronization

-- Table: user_calendar_connections
-- Stores OAuth tokens and connection status for each user's Google Calendar
create table if not exists public.user_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  google_email text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  token_expires_at timestamptz not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- Table: event_calendar_entries
-- Maps organization events to Google Calendar event IDs per user
create table if not exists public.event_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  google_event_id text not null,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'failed', 'deleted')),
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(event_id, user_id)
);

-- Table: calendar_sync_preferences
-- Stores user preferences for which event types to sync
create table if not exists public.calendar_sync_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sync_general boolean default true,
  sync_game boolean default true,
  sync_meeting boolean default true,
  sync_social boolean default true,
  sync_fundraiser boolean default true,
  sync_philanthropy boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, organization_id)
);

-- Indexes for performance
create index if not exists user_calendar_connections_user_id_idx on public.user_calendar_connections(user_id);
create index if not exists user_calendar_connections_status_idx on public.user_calendar_connections(status);

create index if not exists event_calendar_entries_event_id_idx on public.event_calendar_entries(event_id);
create index if not exists event_calendar_entries_user_id_idx on public.event_calendar_entries(user_id);
create index if not exists event_calendar_entries_org_id_idx on public.event_calendar_entries(organization_id);
create index if not exists event_calendar_entries_sync_status_idx on public.event_calendar_entries(sync_status);

create index if not exists calendar_sync_preferences_user_id_idx on public.calendar_sync_preferences(user_id);
create index if not exists calendar_sync_preferences_org_id_idx on public.calendar_sync_preferences(organization_id);

-- Enable RLS on all tables
alter table public.user_calendar_connections enable row level security;
alter table public.event_calendar_entries enable row level security;
alter table public.calendar_sync_preferences enable row level security;

-- RLS Policies for user_calendar_connections
-- Users can only view and manage their own calendar connections

drop policy if exists user_calendar_connections_select on public.user_calendar_connections;
create policy user_calendar_connections_select on public.user_calendar_connections
  for select
  using (auth.uid() = user_id);

drop policy if exists user_calendar_connections_insert on public.user_calendar_connections;
create policy user_calendar_connections_insert on public.user_calendar_connections
  for insert
  with check (auth.uid() = user_id);

drop policy if exists user_calendar_connections_update on public.user_calendar_connections;
create policy user_calendar_connections_update on public.user_calendar_connections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_calendar_connections_delete on public.user_calendar_connections;
create policy user_calendar_connections_delete on public.user_calendar_connections
  for delete
  using (auth.uid() = user_id);

-- RLS Policies for event_calendar_entries
-- Users can view their own entries, admins can view all in their org

drop policy if exists event_calendar_entries_select on public.event_calendar_entries;
create policy event_calendar_entries_select on public.event_calendar_entries
  for select
  using (
    auth.uid() = user_id
    or public.has_active_role(organization_id, array['admin'])
  );

drop policy if exists event_calendar_entries_insert on public.event_calendar_entries;
create policy event_calendar_entries_insert on public.event_calendar_entries
  for insert
  with check (
    auth.uid() = user_id
    or public.has_active_role(organization_id, array['admin'])
  );

drop policy if exists event_calendar_entries_update on public.event_calendar_entries;
create policy event_calendar_entries_update on public.event_calendar_entries
  for update
  using (
    auth.uid() = user_id
    or public.has_active_role(organization_id, array['admin'])
  )
  with check (
    auth.uid() = user_id
    or public.has_active_role(organization_id, array['admin'])
  );

drop policy if exists event_calendar_entries_delete on public.event_calendar_entries;
create policy event_calendar_entries_delete on public.event_calendar_entries
  for delete
  using (
    auth.uid() = user_id
    or public.has_active_role(organization_id, array['admin'])
  );

-- RLS Policies for calendar_sync_preferences
-- Users can only manage their own preferences

drop policy if exists calendar_sync_preferences_select on public.calendar_sync_preferences;
create policy calendar_sync_preferences_select on public.calendar_sync_preferences
  for select
  using (auth.uid() = user_id);

drop policy if exists calendar_sync_preferences_insert on public.calendar_sync_preferences;
create policy calendar_sync_preferences_insert on public.calendar_sync_preferences
  for insert
  with check (
    auth.uid() = user_id
    and public.has_active_role(organization_id, array['admin', 'active_member', 'alumni'])
  );

drop policy if exists calendar_sync_preferences_update on public.calendar_sync_preferences;
create policy calendar_sync_preferences_update on public.calendar_sync_preferences
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists calendar_sync_preferences_delete on public.calendar_sync_preferences;
create policy calendar_sync_preferences_delete on public.calendar_sync_preferences
  for delete
  using (auth.uid() = user_id);

-- Trigger to update updated_at timestamp for user_calendar_connections
create or replace function public.update_user_calendar_connections_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_calendar_connections_updated_at on public.user_calendar_connections;
create trigger user_calendar_connections_updated_at
  before update on public.user_calendar_connections
  for each row
  execute function public.update_user_calendar_connections_updated_at();

-- Trigger to update updated_at timestamp for event_calendar_entries
create or replace function public.update_event_calendar_entries_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists event_calendar_entries_updated_at on public.event_calendar_entries;
create trigger event_calendar_entries_updated_at
  before update on public.event_calendar_entries
  for each row
  execute function public.update_event_calendar_entries_updated_at();

-- Trigger to update updated_at timestamp for calendar_sync_preferences
create or replace function public.update_calendar_sync_preferences_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calendar_sync_preferences_updated_at on public.calendar_sync_preferences;
create trigger calendar_sync_preferences_updated_at
  before update on public.calendar_sync_preferences
  for each row
  execute function public.update_calendar_sync_preferences_updated_at();
