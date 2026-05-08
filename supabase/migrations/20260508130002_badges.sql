-- =============================================================================
-- badges + member_badges — earnable achievements per (user, org).
-- =============================================================================
-- The `badges` table is a small, mostly-read seed table; rows are added
-- intentionally by migrations rather than admin UI. Eligibility is evaluated
-- by /api/cron/streaks-recompute and ad-hoc evaluators (so a brand-new badge
-- can be backfilled by editing the cron's evaluator list).
-- =============================================================================

create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  icon text not null, -- lucide-react-native / lucide-react icon name
  -- Free-form criteria for the cron's evaluator: e.g.
  --   { "kind": "streak_weeks", "threshold": 4 }
  --   { "kind": "events_attended", "threshold": 10 }
  --   { "kind": "first_workout" }
  criteria jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.member_badges (
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  badge_id uuid not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, organization_id, badge_id)
);

create index if not exists member_badges_org_user_idx
  on public.member_badges (organization_id, user_id);

create index if not exists member_badges_user_recent_idx
  on public.member_badges (user_id, earned_at desc);

alter table public.badges enable row level security;
alter table public.member_badges enable row level security;

-- Anyone authenticated can read the badge catalog.
drop policy if exists badges_select_all on public.badges;
create policy badges_select_all
  on public.badges for select to authenticated using (true);

-- Members of the org can see who-earned-what for that org (powers profile
-- pages + leaderboards).
drop policy if exists member_badges_select_same_org on public.member_badges;
create policy member_badges_select_same_org
  on public.member_badges
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.members m
      where m.organization_id = public.member_badges.organization_id
        and m.user_id = auth.uid()
        and m.deleted_at is null
    )
  );

-- Inserts/updates/deletes are service-role only (the cron evaluator).

-- =============================================================================
-- Seed initial badge catalog.
-- =============================================================================
-- Five starter badges that the cron can evaluate today. More can be added by
-- adding rows + extending the evaluator list in /api/cron/streaks-recompute.

insert into public.badges (slug, title, description, icon, criteria) values
  ('first-event',   'First Event',     'Attended your first event.',                 'calendar-check', '{"kind":"events_attended","threshold":1}'::jsonb),
  ('event-regular', 'Event Regular',   'Attended 10 events.',                         'calendar-heart', '{"kind":"events_attended","threshold":10}'::jsonb),
  ('streak-month',  'On a Roll',       '4-week attendance streak.',                   'flame',          '{"kind":"streak_weeks","threshold":4}'::jsonb),
  ('streak-season', 'Stayed the Course','12-week attendance streak.',                 'medal',          '{"kind":"streak_weeks","threshold":12}'::jsonb),
  ('first-workout', 'First Workout',   'Logged your first workout.',                  'dumbbell',       '{"kind":"workouts_logged","threshold":1}'::jsonb)
on conflict (slug) do nothing;
