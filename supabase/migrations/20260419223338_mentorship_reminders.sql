-- Mentorship proposal reminders: admin-triggered nudges to mentors with pending proposals.
-- Rate-limited per (org, mentor) via most-recent row lookup (24h window enforced in app code).
-- Idempotent: safe to re-run.
begin;

create table if not exists public.mentorship_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  mentor_user_id uuid not null references auth.users(id) on delete cascade,
  sent_by uuid not null references auth.users(id) on delete cascade,
  pending_count integer not null check (pending_count >= 0),
  created_at timestamptz not null default now()
);

comment on table public.mentorship_reminders is
  'Admin-triggered proposal reminder log. One row per send. Used to enforce per-mentor rate limits.';

create index if not exists mentorship_reminders_org_mentor_created_idx
  on public.mentorship_reminders (organization_id, mentor_user_id, created_at desc);

alter table public.mentorship_reminders enable row level security;

drop policy if exists mentorship_reminders_select on public.mentorship_reminders;
create policy mentorship_reminders_select
  on public.mentorship_reminders
  for select using (
    public.has_active_role(organization_id, array['admin'])
  );

drop policy if exists mentorship_reminders_insert on public.mentorship_reminders;
create policy mentorship_reminders_insert
  on public.mentorship_reminders
  for insert with check (
    public.has_active_role(organization_id, array['admin'])
    and sent_by = (select auth.uid())
  );

commit;
