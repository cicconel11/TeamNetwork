-- Mentorship meetings table for scheduling and tracking mentor-mentee meetings

create table public.mentorship_meetings (
  id                   uuid primary key default gen_random_uuid(),
  pair_id              uuid not null references public.mentorship_pairs(id) on delete cascade,
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  title                text not null check (char_length(title) <= 255),
  scheduled_at         timestamptz not null,
  duration_minutes     integer not null default 60
                         check (duration_minutes between 15 and 480),
  scheduled_end_at     timestamptz,
  platform             text not null check (platform in ('google_meet', 'zoom')),
  meeting_link         text check (meeting_link is null or char_length(meeting_link) <= 2048),
  calendar_event_id    text,
  calendar_sync_status text not null default 'none'
                         check (calendar_sync_status in ('none', 'pending', 'synced', 'failed')),
  created_by           uuid not null references auth.users(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

-- Index on pair_id for efficient pair-based queries
create index mentorship_meetings_pair_id_idx on public.mentorship_meetings(pair_id)
  where deleted_at is null;

-- Index on scheduled_end_at for upcoming/past split (eliminates expression scan)
create index mentorship_meetings_end_at_idx on public.mentorship_meetings(scheduled_end_at)
  where deleted_at is null;

-- Trigger to compute scheduled_end_at from scheduled_at + duration
CREATE OR REPLACE FUNCTION public.compute_meeting_end_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.scheduled_end_at := NEW.scheduled_at + (NEW.duration_minutes * interval '1 minute');
  RETURN NEW;
END;
$$;

CREATE TRIGGER mentorship_meetings_compute_end
  BEFORE INSERT OR UPDATE OF scheduled_at, duration_minutes ON public.mentorship_meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_meeting_end_at();

alter table public.mentorship_meetings enable row level security;

-- SELECT: pair members + admins
create policy mentorship_meetings_select on public.mentorship_meetings
  for select using (
    deleted_at is null
    and (
      has_active_role(organization_id, array['admin'])
      or exists (
        select 1 from public.mentorship_pairs p
        where p.id = pair_id
          and p.deleted_at is null
          and (p.mentor_user_id = (select auth.uid()) or p.mentee_user_id = (select auth.uid()))
      )
    )
  );

-- INSERT: mentor of the pair only
create policy mentorship_meetings_insert_mentor on public.mentorship_meetings
  for insert with check (
    exists (
      select 1 from public.mentorship_pairs p
      where p.id = pair_id
        and p.deleted_at is null
        and p.mentor_user_id = (select auth.uid())
    )
  );

-- INSERT: admin
create policy mentorship_meetings_insert_admin on public.mentorship_meetings
  for insert with check (
    has_active_role(organization_id, array['admin'])
  );

-- UPDATE: mentor + admin only (soft-delete via UPDATE)
create policy mentorship_meetings_update on public.mentorship_meetings
  for update
  using (
    deleted_at is null
    and (
      has_active_role(organization_id, array['admin'])
      or exists (
        select 1 from public.mentorship_pairs p
        where p.id = pair_id
          and p.deleted_at is null
          and p.mentor_user_id = (select auth.uid())
      )
    )
  )
  with check (
    pair_id = (select pair_id from public.mentorship_meetings m2 where m2.id = mentorship_meetings.id)
    and organization_id = (select organization_id from public.mentorship_meetings m2 where m2.id = mentorship_meetings.id)
  );
