-- =============================================================================
-- member_streaks — per-(user, org) attendance streaks.
-- =============================================================================
-- "Attendance" is qualifying weekly activity:
--   - any event_rsvps row where status='attending' AND checked_in_at IS NOT NULL
--     in a given ISO week counts that week as qualifying.
-- A streak is the count of consecutive qualifying weeks ending in the most
-- recent calendar week (Mon-Sun, UTC). Missing a week resets `current_weeks`
-- to 0; longest_weeks never decreases.
--
-- Recompute is performed by /api/cron/streaks-recompute daily.
-- =============================================================================

create table if not exists public.member_streaks (
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  current_weeks integer not null default 0,
  longest_weeks integer not null default 0,
  last_qualifying_week_start date,
  last_recomputed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index if not exists member_streaks_org_current_idx
  on public.member_streaks (organization_id, current_weeks desc);

create index if not exists member_streaks_org_longest_idx
  on public.member_streaks (organization_id, longest_weeks desc);

alter table public.member_streaks enable row level security;

-- Members of the org can see streaks for that org. The leaderboard surface
-- queries by organization_id; RLS gates by org membership rather than per-row.
drop policy if exists member_streaks_select_same_org on public.member_streaks;
create policy member_streaks_select_same_org
  on public.member_streaks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.members m
      where m.organization_id = public.member_streaks.organization_id
        and m.user_id = auth.uid()
        and m.deleted_at is null
    )
  );

-- Writes are service-role only (the cron). Clients never directly write streak
-- rows — they're always derived from RSVPs.

create or replace function public.tg_member_streaks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_streaks_updated_at on public.member_streaks;
create trigger member_streaks_updated_at
  before update on public.member_streaks
  for each row execute function public.tg_member_streaks_updated_at();

comment on table public.member_streaks is
  'Per-(user,org) attendance streak. Recomputed daily by /api/cron/streaks-recompute. longest_weeks never decreases.';
