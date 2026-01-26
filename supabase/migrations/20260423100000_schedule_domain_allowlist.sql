create table if not exists public.schedule_domain_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null unique,
  vendor_id text not null,
  status text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_allowed_domains (
  id uuid primary key default gen_random_uuid(),
  hostname text not null unique,
  vendor_id text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  verified_by_user_id uuid null,
  verified_by_org_id uuid null,
  verified_at timestamptz null,
  verification_method text null,
  fingerprint jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.schedule_domain_rules enable row level security;
alter table public.schedule_allowed_domains enable row level security;

-- Seed platform domain rules
insert into public.schedule_domain_rules (pattern, vendor_id)
values
  ('*.sportsengine.com', 'sportsengine'),
  ('*.sportngin.com', 'sportsengine'),
  ('sportsengine.com', 'sportsengine'),
  ('sportngin.com', 'sportsengine'),
  ('*.teamsnap.com', 'teamsnap'),
  ('teamsnap.com', 'teamsnap'),
  ('*.leagueapps.com', 'leagueapps'),
  ('leagueapps.com', 'leagueapps'),
  ('*.arbitersports.com', 'arbiter'),
  ('arbitersports.com', 'arbiter'),
  ('app.arbitersports.com', 'arbiter'),
  ('www1.arbitersports.com', 'arbiter'),
  ('*.bigteams.com', 'bigteams'),
  ('bigteams.com', 'bigteams'),
  ('schedulestar.bigteams.com', 'bigteams'),
  ('*.rankone.com', 'rankone'),
  ('rankone.com', 'rankone'),
  ('*.rankonesport.com', 'rankone'),
  ('rankonesport.com', 'rankone'),
  ('app.rankone.com', 'rankone'),
  ('activityscheduler.com', 'rschooltoday'),
  ('*.rschooltoday.com', 'rschooltoday'),
  ('*.sidearmsports.com', 'sidearmsports'),
  ('sidearmsports.com', 'sidearmsports'),
  ('*.prestosports.com', 'prestosports'),
  ('prestosports.com', 'prestosports'),
  ('vantagesportz.com', 'vantage'),
  ('*.vantagesportz.com', 'vantage')
on conflict (pattern) do nothing;
