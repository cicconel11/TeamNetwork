-- Stripe-powered donations: per-org donation events and aggregate metrics

-- Donation events recorded from Stripe webhooks (funds settle directly to the org's connected account)
create table if not exists public.organization_donations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'usd',
  status text not null,
  donor_name text,
  donor_email text,
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  event_id uuid references public.events(id),
  purpose text,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Ensure columns exist when the table predates this migration
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'currency'
  ) then
    alter table public.organization_donations add column currency text not null default 'usd';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'stripe_checkout_session_id'
  ) then
    alter table public.organization_donations add column stripe_checkout_session_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'event_id'
  ) then
    alter table public.organization_donations add column event_id uuid references public.events(id);
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'purpose'
  ) then
    alter table public.organization_donations add column purpose text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'metadata'
  ) then
    alter table public.organization_donations add column metadata jsonb;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organization_donations' and column_name = 'updated_at'
  ) then
    alter table public.organization_donations add column updated_at timestamptz not null default timezone('utc', now());
  end if;
end;
$$;

create index if not exists organization_donations_org_idx on public.organization_donations(organization_id);
create index if not exists organization_donations_status_idx on public.organization_donations(organization_id, status);
create index if not exists organization_donations_pi_idx on public.organization_donations(stripe_payment_intent_id);
create unique index if not exists organization_donations_pi_unique on public.organization_donations(stripe_payment_intent_id);
create unique index if not exists organization_donations_checkout_session_unique on public.organization_donations(stripe_checkout_session_id);

drop trigger if exists organization_donations_updated_at on public.organization_donations;
create trigger organization_donations_updated_at
  before update on public.organization_donations
  for each row
  execute function update_updated_at_column();

alter table public.organization_donations enable row level security;

drop policy if exists organization_donations_select on public.organization_donations;
create policy organization_donations_select on public.organization_donations
  for select using (public.has_active_role(organization_id, array['admin', 'active_member', 'alumni']));

drop policy if exists organization_donations_insert on public.organization_donations;
create policy organization_donations_insert on public.organization_donations
  for insert with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists organization_donations_update on public.organization_donations;
create policy organization_donations_update on public.organization_donations
  for update using (public.can_edit_page(organization_id, '/donations'))
  with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists organization_donations_delete on public.organization_donations;
create policy organization_donations_delete on public.organization_donations
  for delete using (public.can_edit_page(organization_id, '/donations'));

-- Aggregate donation metrics per organization (kept in sync by Stripe webhooks)
create table if not exists public.organization_donation_stats (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  total_amount_cents bigint not null default 0,
  donation_count integer not null default 0,
  last_donation_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists organization_donation_stats_updated_at on public.organization_donation_stats;
create trigger organization_donation_stats_updated_at
  before update on public.organization_donation_stats
  for each row
  execute function update_updated_at_column();

alter table public.organization_donation_stats enable row level security;

drop policy if exists organization_donation_stats_select on public.organization_donation_stats;
create policy organization_donation_stats_select on public.organization_donation_stats
  for select using (public.has_active_role(organization_id, array['admin', 'active_member', 'alumni']));

drop policy if exists organization_donation_stats_upsert on public.organization_donation_stats;
create policy organization_donation_stats_upsert on public.organization_donation_stats
  for all using (public.can_edit_page(organization_id, '/donations'))
  with check (public.can_edit_page(organization_id, '/donations'));

-- Atomic helper to increment stats from webhook handlers
create or replace function public.increment_donation_stats(
  p_org_id uuid,
  p_amount_delta bigint,
  p_count_delta integer,
  p_last timestamptz
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.organization_donation_stats (
    organization_id,
    total_amount_cents,
    donation_count,
    last_donation_at
  )
  values (
    p_org_id,
    coalesce(p_amount_delta, 0),
    coalesce(p_count_delta, 0),
    p_last
  )
  on conflict (organization_id) do update set
    total_amount_cents = public.organization_donation_stats.total_amount_cents + coalesce(p_amount_delta, 0),
    donation_count = public.organization_donation_stats.donation_count + coalesce(p_count_delta, 0),
    last_donation_at = coalesce(
      greatest(public.organization_donation_stats.last_donation_at, excluded.last_donation_at),
      public.organization_donation_stats.last_donation_at,
      excluded.last_donation_at
    ),
    updated_at = timezone('utc', now());
end;
$$;

-- Backfill donation events and stats from existing manual records (if any)
insert into public.organization_donations (
  organization_id,
  amount_cents,
  currency,
  status,
  donor_name,
  donor_email,
  purpose,
  created_at
)
select
  organization_id,
  coalesce((amount::numeric * 100)::integer, 0),
  'usd',
  'recorded',
  donor_name,
  donor_email,
  nullif(campaign, ''),
  coalesce(date::timestamptz, timezone('utc', now()))
from public.donations
where deleted_at is null
on conflict (stripe_payment_intent_id) do nothing;

insert into public.organization_donation_stats (organization_id, total_amount_cents, donation_count, last_donation_at)
select
  organization_id,
  coalesce((sum(amount)::numeric * 100)::bigint, 0),
  count(*),
  max(coalesce(date::timestamptz, created_at))
from public.donations
where deleted_at is null
group by organization_id
on conflict (organization_id) do update set
  total_amount_cents = excluded.total_amount_cents,
  donation_count = excluded.donation_count,
  last_donation_at = excluded.last_donation_at,
  updated_at = timezone('utc', now());
