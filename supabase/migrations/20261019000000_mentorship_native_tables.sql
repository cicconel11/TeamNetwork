-- Mentorship native tables (Phase 1 of native-data cutover)
-- Adds dedicated mentee_preferences table + athletic/industry/role_family arrays on
-- mentor_profiles. Backfills mentee_preferences from mentee_latest_intake view.
--
-- Mentor athletic backfill is deferred by design — best effort. Mentors fill in
-- via Phase 3 card; matching keeps derivation fallback until Phase 6.
--
-- Idempotent: safe to re-run.
begin;

-- =============================================================================
-- 1. set_updated_at helper (local; reuse if global exists)
-- =============================================================================

create or replace function public.mentee_preferences_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 2. mentee_preferences table
-- =============================================================================

create table if not exists public.mentee_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goals text,
  preferred_topics text[] not null default '{}',
  preferred_industries text[] not null default '{}',
  preferred_role_families text[] not null default '{}',
  preferred_sports text[] not null default '{}',
  preferred_positions text[] not null default '{}',
  required_attributes text[] not null default '{}',
  nice_to_have_attributes text[] not null default '{}',
  time_availability text,
  communication_prefs text[] not null default '{}',
  geographic_pref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.mentee_preferences is
  'Canonical mentee matching preferences. One row per (org, user). Replaces mentee_latest_intake projection.';

create index if not exists mentee_preferences_org_idx
  on public.mentee_preferences(organization_id);

drop trigger if exists mentee_preferences_set_updated_at_trg on public.mentee_preferences;
create trigger mentee_preferences_set_updated_at_trg
  before update on public.mentee_preferences
  for each row
  execute function public.mentee_preferences_set_updated_at();

-- RLS
alter table public.mentee_preferences enable row level security;

drop policy if exists mentee_preferences_select on public.mentee_preferences;
create policy mentee_preferences_select
  on public.mentee_preferences
  for select using (
    (
      user_id = (select auth.uid())
      and public.has_active_role(organization_id, array['admin','active_member','alumni','parent'])
    )
    or public.has_active_role(organization_id, array['admin'])
  );

drop policy if exists mentee_preferences_insert on public.mentee_preferences;
create policy mentee_preferences_insert
  on public.mentee_preferences
  for insert with check (
    user_id = (select auth.uid())
    and public.has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

drop policy if exists mentee_preferences_update on public.mentee_preferences;
create policy mentee_preferences_update
  on public.mentee_preferences
  for update using (
    user_id = (select auth.uid())
    and public.has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  ) with check (
    user_id = (select auth.uid())
    and public.has_active_role(organization_id, array['admin','active_member','alumni','parent'])
  );

drop policy if exists mentee_preferences_delete on public.mentee_preferences;
create policy mentee_preferences_delete
  on public.mentee_preferences
  for delete using (
    (
      user_id = (select auth.uid())
      and public.has_active_role(organization_id, array['admin','active_member','alumni','parent'])
    )
    or public.has_active_role(organization_id, array['admin'])
  );

-- =============================================================================
-- 3. mentor_profiles native athletic + career arrays
-- =============================================================================

alter table public.mentor_profiles
  add column if not exists sports text[] not null default '{}',
  add column if not exists positions text[] not null default '{}',
  add column if not exists industries text[] not null default '{}',
  add column if not exists role_families text[] not null default '{}';

comment on column public.mentor_profiles.sports is 'Canonical sport tags (e.g. basketball, football).';
comment on column public.mentor_profiles.positions is 'Canonical position tags (e.g. point-guard, quarterback).';
comment on column public.mentor_profiles.industries is 'Canonical industry tags.';
comment on column public.mentor_profiles.role_families is 'Canonical role family tags.';

-- =============================================================================
-- 4. Backfill mentee_preferences from mentee_latest_intake view
-- =============================================================================

insert into public.mentee_preferences (
  organization_id, user_id,
  goals,
  preferred_topics, preferred_industries, preferred_role_families,
  preferred_sports, preferred_positions,
  required_attributes, nice_to_have_attributes,
  time_availability, communication_prefs, geographic_pref
)
select
  mli.organization_id,
  mli.user_id,
  nullif(mli.data->>'goals', ''),
  coalesce(array(select jsonb_array_elements_text(mli.data->'preferred_topics')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'preferred_industry')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'preferred_role_families')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'preferred_sports')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'preferred_positions')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'mentor_attributes_required')), '{}'),
  coalesce(array(select jsonb_array_elements_text(mli.data->'mentor_attributes_nice_to_have')), '{}'),
  nullif(mli.data->>'time_availability', ''),
  coalesce(array(select jsonb_array_elements_text(mli.data->'communication_prefs')), '{}'),
  nullif(mli.data->>'geographic_pref', '')
from public.mentee_latest_intake mli
where mli.user_id is not null
  and mli.organization_id is not null
on conflict (organization_id, user_id) do update set
  goals = excluded.goals,
  preferred_topics = excluded.preferred_topics,
  preferred_industries = excluded.preferred_industries,
  preferred_role_families = excluded.preferred_role_families,
  preferred_sports = excluded.preferred_sports,
  preferred_positions = excluded.preferred_positions,
  required_attributes = excluded.required_attributes,
  nice_to_have_attributes = excluded.nice_to_have_attributes,
  time_availability = excluded.time_availability,
  communication_prefs = excluded.communication_prefs,
  geographic_pref = excluded.geographic_pref,
  updated_at = now();

commit;
