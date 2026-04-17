-- Mentorship matching substrate (Phase 1)
-- - Extend mentor_profiles with capacity, topics, meeting prefs, experience
-- - Extend mentorship_pairs lifecycle (proposed/accepted/declined/expired) + scoring + audit
-- - Capacity maintenance trigger
-- - Cross-tenant org_id integrity trigger
-- - RLS: mentee self-propose, mentor self-accept/decline, admin unrestricted (all with WITH CHECK)
-- - Notification preference: mentorship_emails_enabled
-- - organizations.settings jsonb for per-org matcher weights

begin;

-- =============================================================================
-- 1. mentor_profiles extensions
-- =============================================================================

alter table public.mentor_profiles
  add column if not exists max_mentees int not null default 3 check (max_mentees >= 0),
  add column if not exists current_mentee_count int not null default 0 check (current_mentee_count >= 0),
  add column if not exists accepting_new boolean not null default true,
  add column if not exists topics text[] not null default '{}',
  add column if not exists time_commitment text,
  add column if not exists meeting_preferences text[] not null default '{}',
  add column if not exists years_of_experience int check (years_of_experience is null or years_of_experience >= 0);

comment on column public.mentor_profiles.max_mentees is 'Maximum active mentees mentor will accept.';
comment on column public.mentor_profiles.current_mentee_count is 'Trigger-maintained count of active+proposed pairs.';
comment on column public.mentor_profiles.accepting_new is 'Mentor toggle to pause new proposals without deactivating.';
comment on column public.mentor_profiles.topics is 'Org-configured generic taxonomy (e.g. finance, wellness, recruiting).';
comment on column public.mentor_profiles.time_commitment is 'Free-text commitment (e.g. "1hr/month","flexible").';
comment on column public.mentor_profiles.meeting_preferences is 'e.g. ["video","phone","in_person"].';
comment on column public.mentor_profiles.years_of_experience is 'Years past graduation / years of work experience.';

-- =============================================================================
-- 2. mentorship_pairs lifecycle + scoring + audit
-- =============================================================================

alter table public.mentorship_pairs
  drop constraint if exists mentorship_pairs_status_check;

alter table public.mentorship_pairs
  add constraint mentorship_pairs_status_check
    check (status in ('proposed','accepted','declined','active','paused','completed','expired'));

alter table public.mentorship_pairs
  add column if not exists proposed_by uuid references auth.users(id) on delete set null,
  add column if not exists proposed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists declined_reason text,
  add column if not exists match_score numeric(6,3),
  add column if not exists match_signals jsonb,
  add column if not exists deleted_at timestamptz;

comment on column public.mentorship_pairs.proposed_by is 'User who created the proposal (mentee self-request, admin match, mentor invite).';
comment on column public.mentorship_pairs.match_score is 'Score at time of proposal (auditable).';
comment on column public.mentorship_pairs.match_signals is 'Array of {code,weight,value} signals explaining score.';

create index if not exists mentorship_pairs_status_idx
  on public.mentorship_pairs(organization_id, status)
  where deleted_at is null;

-- =============================================================================
-- 3. Capacity maintenance trigger
-- =============================================================================

create or replace function public.mentorship_recompute_mentor_capacity(p_mentor_user_id uuid, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mentor_profiles mp
     set current_mentee_count = (
       select count(*)
         from public.mentorship_pairs pr
        where pr.mentor_user_id = p_mentor_user_id
          and pr.organization_id = p_org_id
          and pr.status in ('proposed','accepted','active','paused')
          and pr.deleted_at is null
     ),
     updated_at = now()
   where mp.user_id = p_mentor_user_id
     and mp.organization_id = p_org_id;
end;
$$;

create or replace function public.mentorship_pairs_capacity_maintain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.mentorship_recompute_mentor_capacity(new.mentor_user_id, new.organization_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.mentorship_recompute_mentor_capacity(new.mentor_user_id, new.organization_id);
    if old.mentor_user_id is distinct from new.mentor_user_id
       or old.organization_id is distinct from new.organization_id then
      perform public.mentorship_recompute_mentor_capacity(old.mentor_user_id, old.organization_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.mentorship_recompute_mentor_capacity(old.mentor_user_id, old.organization_id);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists mentor_pair_capacity_maintain on public.mentorship_pairs;
create trigger mentor_pair_capacity_maintain
  after insert or update or delete on public.mentorship_pairs
  for each row
  execute function public.mentorship_pairs_capacity_maintain();

-- Backfill existing rows
update public.mentor_profiles mp
   set current_mentee_count = coalesce((
     select count(*) from public.mentorship_pairs pr
      where pr.mentor_user_id = mp.user_id
        and pr.organization_id = mp.organization_id
        and pr.status in ('proposed','accepted','active','paused')
        and pr.deleted_at is null
   ), 0);

-- =============================================================================
-- 4. Cross-tenant org_id integrity trigger
-- Prevents caller supplying mismatched organization_id vs mentor/mentee membership.
-- =============================================================================

create or replace function public.mentorship_pairs_enforce_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor_org uuid;
  v_mentee_org uuid;
begin
  -- Verify mentor belongs to stated org via user_organization_roles
  select organization_id into v_mentor_org
    from public.user_organization_roles
   where user_id = new.mentor_user_id
     and organization_id = new.organization_id
     and status = 'active'
   limit 1;

  if v_mentor_org is null then
    raise exception 'mentor_user_id % is not an active member of organization_id %',
      new.mentor_user_id, new.organization_id
      using errcode = '42501';
  end if;

  select organization_id into v_mentee_org
    from public.user_organization_roles
   where user_id = new.mentee_user_id
     and organization_id = new.organization_id
     and status = 'active'
   limit 1;

  if v_mentee_org is null then
    raise exception 'mentee_user_id % is not an active member of organization_id %',
      new.mentee_user_id, new.organization_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists mentorship_pairs_enforce_tenant_trigger on public.mentorship_pairs;
create trigger mentorship_pairs_enforce_tenant_trigger
  before insert or update of mentor_user_id, mentee_user_id, organization_id
  on public.mentorship_pairs
  for each row
  execute function public.mentorship_pairs_enforce_tenant();

-- =============================================================================
-- 5. Transition + immutability trigger (defense-in-depth for RLS)
-- RLS constrains *who* can update; this trigger constrains *what* they may change.
-- =============================================================================

create or replace function public.mentorship_pairs_enforce_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_caller uuid;
begin
  v_caller := auth.uid();
  v_is_admin := public.has_active_role(new.organization_id, array['admin']);

  -- INSERT: only proposed rows from non-admin; trigger owns audit fields
  if tg_op = 'INSERT' and not v_is_admin then
    if new.status <> 'proposed' then
      raise exception 'non-admin INSERT must have status=proposed' using errcode = '42501';
    end if;
    if new.deleted_at is not null then
      raise exception 'non-admin INSERT must not set deleted_at' using errcode = '42501';
    end if;
    if new.accepted_at is not null then
      raise exception 'non-admin INSERT must not set accepted_at' using errcode = '42501';
    end if;
    if new.declined_at is not null then
      raise exception 'non-admin INSERT must not set declined_at' using errcode = '42501';
    end if;
    if new.declined_reason is not null then
      raise exception 'non-admin INSERT must not set declined_reason' using errcode = '42501';
    end if;
    if new.match_score is not null then
      raise exception 'non-admin INSERT must not set match_score' using errcode = '42501';
    end if;
    if new.match_signals is not null then
      raise exception 'non-admin INSERT must not set match_signals' using errcode = '42501';
    end if;

    new.proposed_by := v_caller;
    new.proposed_at := now();
  end if;

  -- Immutable columns on UPDATE (admin may override)
  if tg_op = 'UPDATE' and not v_is_admin then
    if old.mentor_user_id is distinct from new.mentor_user_id then
      raise exception 'mentor_user_id is immutable' using errcode = '42501';
    end if;
    if old.mentee_user_id is distinct from new.mentee_user_id then
      raise exception 'mentee_user_id is immutable' using errcode = '42501';
    end if;
    if old.organization_id is distinct from new.organization_id then
      raise exception 'organization_id is immutable' using errcode = '42501';
    end if;
    if old.proposed_by is distinct from new.proposed_by then
      raise exception 'proposed_by is immutable' using errcode = '42501';
    end if;
    if old.proposed_at is distinct from new.proposed_at then
      raise exception 'proposed_at is immutable' using errcode = '42501';
    end if;
    if old.match_score is distinct from new.match_score then
      raise exception 'match_score is immutable' using errcode = '42501';
    end if;
    if old.match_signals is distinct from new.match_signals then
      raise exception 'match_signals is immutable' using errcode = '42501';
    end if;
    if old.deleted_at is distinct from new.deleted_at then
      raise exception 'deleted_at may only be set by admin' using errcode = '42501';
    end if;
  end if;

  -- Status transition allowlist when status changes (admin bypasses)
  if tg_op = 'UPDATE' and old.status is distinct from new.status and not v_is_admin then
    -- Mentor: proposed -> accepted|declined on own pair
    if new.mentor_user_id = v_caller and old.status = 'proposed'
       and new.status = 'accepted' then
      new.accepted_at := now();
      new.declined_at := null;
      new.declined_reason := null;
    elsif new.mentor_user_id = v_caller and old.status = 'proposed'
          and new.status = 'declined' then
      new.accepted_at := null;
      new.declined_at := now();
    -- Mentee: proposed -> declined (withdraw) on own pair
    elsif new.mentee_user_id = v_caller and old.status = 'proposed'
          and new.status = 'declined' then
      new.accepted_at := null;
      new.declined_at := now();
    -- Either participant: accepted|active -> completed
    elsif (new.mentor_user_id = v_caller or new.mentee_user_id = v_caller)
          and old.status in ('accepted','active') and new.status = 'completed' then
      if old.accepted_at is distinct from new.accepted_at then
        raise exception 'accepted_at is immutable outside acceptance' using errcode = '42501';
      end if;
      if old.declined_at is distinct from new.declined_at then
        raise exception 'declined_at is immutable outside decline' using errcode = '42501';
      end if;
      if old.declined_reason is distinct from new.declined_reason then
        raise exception 'declined_reason is immutable outside decline' using errcode = '42501';
      end if;
    else
      raise exception 'illegal mentorship_pairs status transition % -> % by user %',
        old.status, new.status, v_caller using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status and not v_is_admin then
    if old.accepted_at is distinct from new.accepted_at then
      raise exception 'accepted_at is immutable outside acceptance' using errcode = '42501';
    end if;
    if old.declined_at is distinct from new.declined_at then
      raise exception 'declined_at is immutable outside decline' using errcode = '42501';
    end if;
    if old.declined_reason is distinct from new.declined_reason then
      raise exception 'declined_reason is immutable outside decline' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists mentorship_pairs_enforce_transition_trigger on public.mentorship_pairs;
create trigger mentorship_pairs_enforce_transition_trigger
  before insert or update on public.mentorship_pairs
  for each row
  execute function public.mentorship_pairs_enforce_transition();

-- =============================================================================
-- 6. RLS — mentee/mentor self-service + admin unrestricted
-- Drops broad policies from earlier migrations so final state matches Phase 1.
-- =============================================================================

-- Remove prior broad policies (from 20260101000000 and 20260421130000)
drop policy if exists mentorship_pairs_select on public.mentorship_pairs;
drop policy if exists mentorship_pairs_insert on public.mentorship_pairs;
drop policy if exists mentorship_pairs_update on public.mentorship_pairs;
drop policy if exists mentorship_pairs_delete on public.mentorship_pairs;
-- Also drop any named policies this migration may have created on a rerun
drop policy if exists mentorship_pairs_insert_admin on public.mentorship_pairs;
drop policy if exists mentorship_pairs_insert_mentee on public.mentorship_pairs;
drop policy if exists mentorship_pairs_insert_mentor on public.mentorship_pairs;
drop policy if exists mentorship_pairs_update_admin on public.mentorship_pairs;
drop policy if exists mentorship_pairs_update_mentor on public.mentorship_pairs;
drop policy if exists mentorship_pairs_update_mentee on public.mentorship_pairs;

-- SELECT: admin OR active participant (has_active_role gate blocks revoked users)
create policy mentorship_pairs_select
  on public.mentorship_pairs
  for select using (
    has_active_role(organization_id, array['admin','active_member','alumni'])
    and (
      has_active_role(organization_id, array['admin'])
      or mentor_user_id = auth.uid()
      or mentee_user_id = auth.uid()
    )
  );

-- INSERT admin: unrestricted
create policy mentorship_pairs_insert_admin
  on public.mentorship_pairs
  for insert with check (has_active_role(organization_id, array['admin']));

-- INSERT mentee: self-propose only
create policy mentorship_pairs_insert_mentee
  on public.mentorship_pairs
  for insert with check (
    mentee_user_id = auth.uid()
    and status = 'proposed'
    and has_active_role(organization_id, array['active_member','alumni'])
  );

-- INSERT mentor: self-invite only
create policy mentorship_pairs_insert_mentor
  on public.mentorship_pairs
  for insert with check (
    mentor_user_id = auth.uid()
    and status = 'proposed'
    and has_active_role(organization_id, array['alumni','active_member'])
  );

-- UPDATE admin: unrestricted
create policy mentorship_pairs_update_admin
  on public.mentorship_pairs
  for update using (has_active_role(organization_id, array['admin']))
  with check (has_active_role(organization_id, array['admin']));

-- UPDATE mentor: accept/decline proposed pair (transition trigger enforces specifics)
create policy mentorship_pairs_update_mentor
  on public.mentorship_pairs
  for update using (
    mentor_user_id = auth.uid()
    and has_active_role(organization_id, array['alumni','active_member'])
    and status = 'proposed'
    and deleted_at is null
  )
  with check (
    mentor_user_id = auth.uid()
    and status in ('accepted','declined')
  );

-- UPDATE mentee: withdraw proposed (->declined) or mark accepted/active pair completed
create policy mentorship_pairs_update_mentee
  on public.mentorship_pairs
  for update using (
    mentee_user_id = auth.uid()
    and has_active_role(organization_id, array['active_member','alumni'])
    and status in ('proposed','accepted','active')
    and deleted_at is null
  )
  with check (
    mentee_user_id = auth.uid()
    and status in ('declined','completed')
  );

-- DELETE: admin only
create policy mentorship_pairs_delete
  on public.mentorship_pairs
  for delete using (has_active_role(organization_id, array['admin']));

-- =============================================================================
-- 6. organizations.settings jsonb for per-org matcher weights
-- =============================================================================

alter table public.organizations
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on column public.organizations.settings is 'Per-org config (e.g. mentorship_weights).';

-- =============================================================================
-- 7. Notification preference flag for mentorship category
-- =============================================================================

alter table public.notification_preferences
  add column if not exists mentorship_emails_enabled boolean not null default true;

commit;
