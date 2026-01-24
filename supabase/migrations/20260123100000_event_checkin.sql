-- Add check-in columns to event_rsvps table
alter table public.event_rsvps
  add column if not exists checked_in_at timestamptz default null,
  add column if not exists checked_in_by uuid references public.users(id) default null;

-- Index for efficient check-in queries
create index if not exists event_rsvps_checked_in_idx
  on public.event_rsvps(event_id, checked_in_at)
  where checked_in_at is not null;

-- Update RLS policy to allow admins to update check-in status for any RSVP in their org
create policy event_rsvps_admin_update on public.event_rsvps
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
