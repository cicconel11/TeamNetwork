-- Organization subscriptions for Stripe paywall
create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  base_plan_interval text not null check (base_plan_interval in ('month', 'year')),
  alumni_bucket text not null default 'none' check (alumni_bucket in ('none', '0-200', '201-600', '601-1500', '1500+')),
  alumni_plan_interval text check (alumni_plan_interval in ('month', 'year')),
  status text not null default 'pending',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_subscriptions_org_idx
  on public.organization_subscriptions(organization_id);

-- Audience targeting for notifications
alter table if exists public.notifications
  add column if not exists audience text not null default 'both' check (audience in ('members', 'alumni', 'both'));

-- Soft delete support
alter table if exists public.members add column if not exists deleted_at timestamptz;
alter table if exists public.alumni add column if not exists deleted_at timestamptz;
alter table if exists public.events add column if not exists deleted_at timestamptz;
alter table if exists public.announcements add column if not exists deleted_at timestamptz;
alter table if exists public.donations add column if not exists deleted_at timestamptz;
alter table if exists public.records add column if not exists deleted_at timestamptz;
alter table if exists public.competition_points add column if not exists deleted_at timestamptz;
alter table if exists public.philanthropy_events add column if not exists deleted_at timestamptz;
alter table if exists public.notifications add column if not exists deleted_at timestamptz;








