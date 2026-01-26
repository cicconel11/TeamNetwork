-- Add organization-scoped calendar feeds/events and scope flags

alter table public.calendar_feeds
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists scope text not null default 'personal' check (scope in ('personal', 'org'));

alter table public.calendar_events
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists scope text not null default 'personal' check (scope in ('personal', 'org'));

create index if not exists calendar_feeds_org_scope_idx on public.calendar_feeds(organization_id, scope);
create index if not exists calendar_events_org_scope_start_idx on public.calendar_events(organization_id, scope, start_at);

-- Update RLS policies for calendar_feeds

drop policy if exists calendar_feeds_select on public.calendar_feeds;
create policy calendar_feeds_select on public.calendar_feeds
  for select
  using (
    (scope = 'personal' and auth.uid() = user_id)
    or (scope = 'org' and public.has_active_role(organization_id, array['admin','active_member','alumni']))
  );

drop policy if exists calendar_feeds_insert on public.calendar_feeds;
create policy calendar_feeds_insert on public.calendar_feeds
  for insert
  with check (
    (scope = 'personal'
      and auth.uid() = user_id
      and public.has_active_role(organization_id, array['admin','active_member','alumni'])
    )
    or (scope = 'org'
      and public.has_active_role(organization_id, array['admin'])
    )
  );

drop policy if exists calendar_feeds_update on public.calendar_feeds;
create policy calendar_feeds_update on public.calendar_feeds
  for update
  using (
    (scope = 'personal' and auth.uid() = user_id)
    or (scope = 'org' and public.has_active_role(organization_id, array['admin']))
  )
  with check (
    (scope = 'personal' and auth.uid() = user_id)
    or (scope = 'org' and public.has_active_role(organization_id, array['admin']))
  );

drop policy if exists calendar_feeds_delete on public.calendar_feeds;
create policy calendar_feeds_delete on public.calendar_feeds
  for delete
  using (
    (scope = 'personal' and auth.uid() = user_id)
    or (scope = 'org' and public.has_active_role(organization_id, array['admin']))
  );

-- Update RLS policies for calendar_events

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  for select
  using (
    auth.uid() = user_id
    or (scope = 'org' and public.has_active_role(organization_id, array['admin','active_member','alumni']))
    or (scope = 'personal' and public.has_active_role(organization_id, array['admin']))
  );
