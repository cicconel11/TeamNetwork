-- Create mentorship_tasks table with RLS, string length checks, and security fixes:
-- 1. SELECT policy scoped to pair members + admins
-- 2. Separate INSERT policies for mentors vs admins (no array['admin','alumni'] anti-pattern)
-- 3. UPDATE policy with WITH CHECK to prevent cross-pair moves via REST API
-- 4. Indexes on pair_id and due_date (filtered on deleted_at)
-- Note: org_id consistency and immutability trigger in Migration 3

create table public.mentorship_tasks (
  id              uuid primary key default gen_random_uuid(),
  pair_id         uuid not null references public.mentorship_pairs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title           text not null check (char_length(title) <= 255),
  description     text check (char_length(description) <= 2000),
  status          text not null default 'todo'
                    check (status in ('todo', 'in_progress', 'done')),
  due_date        date,
  created_by      uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index mentorship_tasks_pair_id_idx on public.mentorship_tasks(pair_id)
  where deleted_at is null;
create index mentorship_tasks_due_date_idx on public.mentorship_tasks(due_date)
  where deleted_at is null and status <> 'done';

alter table public.mentorship_tasks enable row level security;

-- SELECT: pair members only (admin check is implicit via pair membership in admin tooling)
create policy mentorship_tasks_select on public.mentorship_tasks
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

-- INSERT: mentor of the pair only (separate policy for admins below)
create policy mentorship_tasks_insert_mentor on public.mentorship_tasks
  for insert with check (
    exists (
      select 1 from public.mentorship_pairs p
      where p.id = pair_id
        and p.deleted_at is null
        and p.mentor_user_id = (select auth.uid())
    )
  );

-- INSERT: admin can insert for any pair in their org
create policy mentorship_tasks_insert_admin on public.mentorship_tasks
  for insert with check (
    has_active_role(organization_id, array['admin'])
  );

-- UPDATE: pair members + admins can update rows they can see
-- Field-level mentee restriction (status-only) enforced at API layer.
-- WITH CHECK prevents the REST API from bypassing the API route.
create policy mentorship_tasks_update on public.mentorship_tasks
  for update
  using (
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
  )
  with check (
    -- immutable fields — prevent cross-pair moves via direct REST call
    pair_id = (select pair_id from public.mentorship_tasks t2 where t2.id = mentorship_tasks.id)
    and organization_id = (select organization_id from public.mentorship_tasks t2 where t2.id = mentorship_tasks.id)
  );
