-- Schedule sources + events for vendor connectors

create table if not exists public.schedule_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  vendor_id text not null,
  source_url text not null,
  title text,
  status text not null default 'active' check (status in ('active','paused','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null references public.schedule_sources(id) on delete cascade,
  external_uid text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','tentative')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists schedule_events_source_uid_key on public.schedule_events(source_id, external_uid);
create index if not exists schedule_events_org_start_idx on public.schedule_events(org_id, start_at);
create index if not exists schedule_sources_org_idx on public.schedule_sources(org_id);

alter table public.schedule_sources enable row level security;
alter table public.schedule_events enable row level security;

-- Policies for schedule_sources

drop policy if exists schedule_sources_select on public.schedule_sources;
create policy schedule_sources_select on public.schedule_sources
  for select
  using (public.has_active_role(org_id, array['admin','active_member','alumni']));

drop policy if exists schedule_sources_insert on public.schedule_sources;
create policy schedule_sources_insert on public.schedule_sources
  for insert
  with check (public.has_active_role(org_id, array['admin']));

drop policy if exists schedule_sources_update on public.schedule_sources;
create policy schedule_sources_update on public.schedule_sources
  for update
  using (public.has_active_role(org_id, array['admin']))
  with check (public.has_active_role(org_id, array['admin']));

drop policy if exists schedule_sources_delete on public.schedule_sources;
create policy schedule_sources_delete on public.schedule_sources
  for delete
  using (public.has_active_role(org_id, array['admin']));

-- Policies for schedule_events

drop policy if exists schedule_events_select on public.schedule_events;
create policy schedule_events_select on public.schedule_events
  for select
  using (public.has_active_role(org_id, array['admin','active_member','alumni']));
