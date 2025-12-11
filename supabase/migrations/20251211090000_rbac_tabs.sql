-- RBAC roles, membership status, LinkedIn, embeds, mentorship, workouts, competition

-- Extend user_role enum to new roles
alter type public.user_role add value if not exists 'active_member';
alter type public.user_role add value if not exists 'alumni';

-- Map legacy roles to new naming
update public.user_organization_roles
  set role = 'active_member'
  where role = 'member';

update public.user_organization_roles
  set role = 'alumni'
  where role = 'viewer';

-- Membership status for revocation
create type if not exists public.membership_status as enum ('active', 'revoked');

alter table if exists public.user_organization_roles
  add column if not exists status public.membership_status not null default 'active';

-- LinkedIn fields for members and alumni
alter table if exists public.members
  add column if not exists linkedin_url text;

alter table if exists public.alumni
  add column if not exists linkedin_url text;

-- Donation embed url on organizations
alter table if exists public.organizations
  add column if not exists donation_embed_url text;

-- Notifications targeting
alter table if exists public.notifications
  add column if not exists target_user_ids uuid[];

update public.notifications
set audience = 'both'
where audience = 'all';

-- Mentorship tables
create table if not exists public.mentorship_pairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mentor_user_id uuid not null references auth.users(id) on delete cascade,
  mentee_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mentorship_pairs_org_idx on public.mentorship_pairs(organization_id);
create index if not exists mentorship_pairs_mentor_idx on public.mentorship_pairs(mentor_user_id);
create index if not exists mentorship_pairs_mentee_idx on public.mentorship_pairs(mentee_user_id);

create table if not exists public.mentorship_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pair_id uuid not null references public.mentorship_pairs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  notes text,
  progress_metric integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mentorship_logs_org_idx on public.mentorship_logs(organization_id);
create index if not exists mentorship_logs_pair_idx on public.mentorship_logs(pair_id);
create index if not exists mentorship_logs_creator_idx on public.mentorship_logs(created_by);

-- Workouts tables
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  workout_date date,
  external_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workouts_org_idx on public.workouts(organization_id);

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  notes text,
  metrics jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workout_logs_org_idx on public.workout_logs(organization_id);
create index if not exists workout_logs_workout_idx on public.workout_logs(workout_id);
create index if not exists workout_logs_user_idx on public.workout_logs(user_id);

-- Competition extensions
create table if not exists public.competition_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists competition_teams_org_idx on public.competition_teams(organization_id);
create index if not exists competition_teams_comp_idx on public.competition_teams(competition_id);

alter table if exists public.competition_points
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

alter table if exists public.competition_points
  add column if not exists team_id uuid references public.competition_teams(id) on delete set null;

alter table if exists public.competition_points
  add column if not exists reason text;

alter table if exists public.competition_points
  add column if not exists created_by uuid references auth.users(id);

-- Backfill organization_id on competition_points
update public.competition_points cp
set organization_id = c.organization_id
from public.competitions c
where cp.competition_id = c.id
  and cp.organization_id is null;

-- Helper function to check active membership by role
create or replace function public.has_active_role(org uuid, allowed_roles text[])
returns boolean
language sql
as $$
  select exists (
    select 1
    from public.user_organization_roles uor
    where uor.organization_id = org
      and uor.user_id = auth.uid()
      and uor.status = 'active'
      and uor.role = any(allowed_roles)
  );
$$;

-- Enable RLS
alter table public.mentorship_pairs enable row level security;
alter table public.mentorship_logs enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_logs enable row level security;
alter table public.competition_teams enable row level security;
alter table public.competition_points enable row level security;

-- Mentorship pairs policies
create policy if not exists mentorship_pairs_select
  on public.mentorship_pairs
  for select using (
    has_active_role(organization_id, array['admin','active_member','alumni'])
    and (
      has_active_role(organization_id, array['admin'])
      or mentor_user_id = auth.uid()
      or mentee_user_id = auth.uid()
    )
  );

create policy if not exists mentorship_pairs_insert
  on public.mentorship_pairs
  for insert with check (has_active_role(organization_id, array['admin']));

create policy if not exists mentorship_pairs_update
  on public.mentorship_pairs
  for update using (has_active_role(organization_id, array['admin']))
  with check (has_active_role(organization_id, array['admin']));

create policy if not exists mentorship_pairs_delete
  on public.mentorship_pairs
  for delete using (has_active_role(organization_id, array['admin']));

-- Mentorship logs policies
create policy if not exists mentorship_logs_select
  on public.mentorship_logs
  for select using (
    exists (
      select 1
      from public.mentorship_pairs mp
      where mp.id = mentorship_logs.pair_id
        and mp.organization_id = mentorship_logs.organization_id
        and has_active_role(mp.organization_id, array['admin','active_member','alumni'])
        and (
          has_active_role(mp.organization_id, array['admin'])
          or mp.mentor_user_id = auth.uid()
          or mp.mentee_user_id = auth.uid()
        )
    )
  );

create policy if not exists mentorship_logs_insert
  on public.mentorship_logs
  for insert with check (
    exists (
      select 1
      from public.mentorship_pairs mp
      where mp.id = mentorship_logs.pair_id
        and mp.organization_id = mentorship_logs.organization_id
        and (
          has_active_role(mp.organization_id, array['admin'])
          or (has_active_role(mp.organization_id, array['active_member']) and mp.mentee_user_id = auth.uid())
        )
    )
    and created_by = auth.uid()
  );

create policy if not exists mentorship_logs_update
  on public.mentorship_logs
  for update using (
    exists (
      select 1
      from public.mentorship_pairs mp
      where mp.id = mentorship_logs.pair_id
        and mp.organization_id = mentorship_logs.organization_id
        and (
          has_active_role(mp.organization_id, array['admin'])
          or (has_active_role(mp.organization_id, array['active_member']) and mentorship_logs.created_by = auth.uid())
        )
    )
  )
  with check (true);

create policy if not exists mentorship_logs_delete
  on public.mentorship_logs
  for delete using (has_active_role(organization_id, array['admin']));

-- Workouts policies
create policy if not exists workouts_select
  on public.workouts
  for select using (has_active_role(organization_id, array['admin','active_member','alumni']));

create policy if not exists workouts_insert
  on public.workouts
  for insert with check (has_active_role(organization_id, array['admin']));

create policy if not exists workouts_update
  on public.workouts
  for update using (has_active_role(organization_id, array['admin']))
  with check (has_active_role(organization_id, array['admin']));

create policy if not exists workouts_delete
  on public.workouts
  for delete using (has_active_role(organization_id, array['admin']));

-- Workout logs policies
create policy if not exists workout_logs_select
  on public.workout_logs
  for select using (
    has_active_role(organization_id, array['admin','active_member','alumni'])
    and (
      has_active_role(organization_id, array['admin'])
      or user_id = auth.uid()
    )
  );

create policy if not exists workout_logs_insert
  on public.workout_logs
  for insert with check (
    has_active_role(organization_id, array['admin'])
    or (has_active_role(organization_id, array['active_member']) and user_id = auth.uid())
  );

create policy if not exists workout_logs_update
  on public.workout_logs
  for update using (
    has_active_role(organization_id, array['admin'])
    or (has_active_role(organization_id, array['active_member']) and user_id = auth.uid())
  )
  with check (
    has_active_role(organization_id, array['admin'])
    or user_id = auth.uid()
  );

create policy if not exists workout_logs_delete
  on public.workout_logs
  for delete using (has_active_role(organization_id, array['admin']));

-- Competition teams policies
create policy if not exists competition_teams_select
  on public.competition_teams
  for select using (has_active_role(organization_id, array['admin','active_member','alumni']));

create policy if not exists competition_teams_insert
  on public.competition_teams
  for insert with check (has_active_role(organization_id, array['admin']));

create policy if not exists competition_teams_update
  on public.competition_teams
  for update using (has_active_role(organization_id, array['admin']))
  with check (has_active_role(organization_id, array['admin']));

create policy if not exists competition_teams_delete
  on public.competition_teams
  for delete using (has_active_role(organization_id, array['admin']));

-- Competition points policies
create policy if not exists competition_points_select
  on public.competition_points
  for select using (has_active_role(coalesce(organization_id, (select c.organization_id from public.competitions c where c.id = competition_id)), array['admin','active_member','alumni']));

create policy if not exists competition_points_insert
  on public.competition_points
  for insert with check (has_active_role(coalesce(organization_id, (select c.organization_id from public.competitions c where c.id = competition_id)), array['admin']));

create policy if not exists competition_points_update
  on public.competition_points
  for update using (has_active_role(coalesce(organization_id, (select c.organization_id from public.competitions c where c.id = competition_id)), array['admin']))
  with check (has_active_role(coalesce(organization_id, (select c.organization_id from public.competitions c where c.id = competition_id)), array['admin']));

create policy if not exists competition_points_delete
  on public.competition_points
  for delete using (has_active_role(coalesce(organization_id, (select c.organization_id from public.competitions c where c.id = competition_id)), array['admin']));


