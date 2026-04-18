-- Mentorship Phase 2: mentee intake + admin queue + proposal lifecycle
-- Adds:
--   1. forms.system_key + form_kind + immutability trigger (canonical intake identity)
--   2. Seed canonical mentee intake form per org
--   3. mentee_latest_intake view (DISTINCT ON latest submission)
--   4. Partial unique index preventing duplicate active mentorship pairs
--   5. accept_mentorship_proposal RPC (transactional state transition)
--   6. mentorship_audit_log table + RLS
begin;

-- =============================================================================
-- 1. forms canonical identity
-- =============================================================================

alter table public.forms
  add column if not exists system_key text,
  add column if not exists form_kind text not null default 'custom';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'forms_form_kind_check'
  ) then
    alter table public.forms
      add constraint forms_form_kind_check
      check (form_kind in ('custom','mentee_intake','mentor_intake','mid_cycle_feedback','end_cycle_feedback'));
  end if;
end $$;

create unique index if not exists forms_system_key_unique
  on public.forms(organization_id, system_key)
  where system_key is not null;

create or replace function public.forms_enforce_system_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.system_key is distinct from new.system_key then
      raise exception 'forms.system_key is immutable' using errcode = '42501';
    end if;
    if old.form_kind is distinct from new.form_kind then
      raise exception 'forms.form_kind is immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forms_enforce_system_invariants_trigger on public.forms;
create trigger forms_enforce_system_invariants_trigger
  before update on public.forms
  for each row
  execute function public.forms_enforce_system_invariants();

-- =============================================================================
-- 2. Seed canonical mentee intake form per org
-- =============================================================================

with mentee_intake_fields as (
  select jsonb_build_array(
    jsonb_build_object(
      'id','goals','type','textarea','label','Your mentorship goals',
      'required',true,
      'description','What do you hope to get out of mentorship?'
    ),
    jsonb_build_object(
      'id','preferred_topics','type','multiselect','label','Preferred topics',
      'required',false,
      'options', jsonb_build_array('finance','career-pivot','recruiting','leadership','wellness','entrepreneurship','networking','job-search')
    ),
    jsonb_build_object(
      'id','preferred_industry','type','multiselect','label','Preferred industry',
      'required',false,
      'options', jsonb_build_array('Technology','Finance','Healthcare','Media','Consulting','Law','Aerospace','Real Estate','Nonprofit','Sports','Education')
    ),
    jsonb_build_object(
      'id','preferred_role_families','type','multiselect','label','Preferred job field',
      'required',false,
      'options', jsonb_build_array('Engineering','Product','Data','Finance','Consulting','Healthcare','Law','Media','Operations','Research','Sports','Education')
    ),
    jsonb_build_object(
      'id','time_availability','type','select','label','Time availability',
      'required',true,
      'options', jsonb_build_array('1hr/month','2hr/month','4hr/month','flexible')
    ),
    jsonb_build_object(
      'id','communication_prefs','type','multiselect','label','Communication preferences',
      'required',false,
      'options', jsonb_build_array('video','phone','in_person','async')
    ),
    jsonb_build_object(
      'id','geographic_pref','type','text','label','Geographic preference (optional)',
      'required',false
    ),
    jsonb_build_object(
      'id','mentor_attributes_required','type','multiselect','label','Must-have mentor attributes',
      'required',false,
      'options', jsonb_build_array('same_industry','same_role_family','alumni_of_org','local','female','veteran','first_gen')
    ),
    jsonb_build_object(
      'id','mentor_attributes_nice_to_have','type','multiselect','label','Nice-to-have mentor attributes',
      'required',false,
      'options', jsonb_build_array('same_industry','same_role_family','alumni_of_org','local','female','veteran','first_gen')
    )
  ) as fields
)
insert into public.forms (organization_id, title, description, fields, is_active, system_key, form_kind)
select o.id,
       'Mentee Intake',
       'Tell us about your mentorship goals so we can match you with the right mentor.',
       (select fields from mentee_intake_fields),
       true,
       'mentee_intake_v1',
       'mentee_intake'
  from public.organizations o
 where not exists (
   select 1 from public.forms f
    where f.organization_id = o.id
      and f.system_key = 'mentee_intake_v1'
 );

-- =============================================================================
-- 3. mentee_latest_intake view
-- =============================================================================

drop view if exists public.mentee_latest_intake;
create view public.mentee_latest_intake as
select distinct on (fs.user_id, f.organization_id)
       fs.id,
       fs.form_id,
       fs.user_id,
       fs.submitted_at,
       fs.data,
       f.organization_id
  from public.form_submissions fs
  join public.forms f on f.id = fs.form_id
 where f.form_kind = 'mentee_intake'
   and fs.deleted_at is null
   and f.deleted_at is null
 order by fs.user_id, f.organization_id, fs.submitted_at desc;

comment on view public.mentee_latest_intake is
  'Latest mentee_intake submission per user per org. Read-only. RLS inherited from form_submissions.';

-- =============================================================================
-- 4. Partial unique index: prevent duplicate active mentorship pairs
-- =============================================================================

create unique index if not exists mentorship_pairs_active_pair_unique
  on public.mentorship_pairs (organization_id, mentor_user_id, mentee_user_id)
  where status in ('proposed','accepted','active','paused') and deleted_at is null;

-- =============================================================================
-- 5. accept_mentorship_proposal RPC
-- =============================================================================

create or replace function public.accept_mentorship_proposal(
  pair_id uuid,
  admin_override boolean default false
)
returns table(result_pair_id uuid, mentor_user_id uuid, mentee_user_id uuid, organization_id uuid, status text, accepted_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair public.mentorship_pairs%rowtype;
  v_caller uuid;
  v_is_admin boolean;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Serialize concurrent accepts
  select * into v_pair
    from public.mentorship_pairs mp
   where mp.id = accept_mentorship_proposal.pair_id
     and mp.deleted_at is null
   for update;

  if not found then
    raise exception 'mentorship pair % not found', accept_mentorship_proposal.pair_id using errcode = 'P0002';
  end if;

  v_is_admin := public.has_active_role(v_pair.organization_id, array['admin']);

  if admin_override and not v_is_admin then
    raise exception 'admin_override requires admin role' using errcode = '42501';
  end if;

  if v_pair.status = 'accepted' then
    -- idempotent: already accepted, return current row
    return query select v_pair.id, v_pair.mentor_user_id, v_pair.mentee_user_id,
                        v_pair.organization_id, v_pair.status, v_pair.accepted_at;
    return;
  end if;

  if v_pair.status <> 'proposed' then
    raise exception 'pair status % cannot transition to accepted', v_pair.status using errcode = '42501';
  end if;

  -- Non-admin: must be the mentor on this pair
  if not v_is_admin and v_pair.mentor_user_id <> v_caller then
    raise exception 'only the assigned mentor or admin may accept' using errcode = '42501';
  end if;

  update public.mentorship_pairs
     set status = 'accepted',
         accepted_at = now(),
         declined_at = null,
         declined_reason = null
   where id = v_pair.id;

  return query
    select mp.id, mp.mentor_user_id, mp.mentee_user_id,
           mp.organization_id, mp.status, mp.accepted_at
      from public.mentorship_pairs mp
     where mp.id = v_pair.id;
end;
$$;

grant execute on function public.accept_mentorship_proposal(uuid, boolean) to authenticated;

-- =============================================================================
-- 6. mentorship_audit_log
-- =============================================================================

create table if not exists public.mentorship_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  pair_id uuid references public.mentorship_pairs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mentorship_audit_log_org_created_idx
  on public.mentorship_audit_log(organization_id, created_at desc);

alter table public.mentorship_audit_log enable row level security;

drop policy if exists mentorship_audit_log_admin_select on public.mentorship_audit_log;
create policy mentorship_audit_log_admin_select
  on public.mentorship_audit_log
  for select using (public.has_active_role(organization_id, array['admin']));

-- INSERT restricted to service role (no public INSERT policy).

commit;
