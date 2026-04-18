-- Mentorship Phase 2.5: admin_propose_pair RPC
-- Atomic insert of mentorship_pairs with match_score + match_signals.
--
-- Context:
--   Prior to this migration, the admin run-round and mentee self-request paths
--   used the service client to insert a pair and (for the mentee path) a
--   follow-up UPDATE for match_score/match_signals. Because service_role has no
--   JWT, auth.uid() is NULL inside the mentorship_pairs_enforce_transition
--   trigger, so has_active_role(...,'admin') is false -> the trigger rejects
--   non-admin INSERTs that set match_score, or immutable-UPDATEs that change
--   match_score. Result: admin run-round 500s, self-request silently loses
--   score/signals.
--
-- This RPC:
--   1. Validates the actor is an active admin OR the active-member mentee themselves.
--   2. Sets a request-local GUC (app.mentorship_trusted_caller='on') that the
--      transition trigger honors as an admin-equivalent bypass for this row.
--   3. Inserts proposed + score + signals atomically, proposed_by = actor.
--   4. Returns existing non-terminal pair when one already exists (idempotent).
--
-- Reused by:
--   - Admin run-round (actor is admin, mentor/mentee any active members)
--   - Mentee self-request (actor is mentee_user_id)
--   - Future AI "Request intro" CTA (Amendment D Option 1: admin-only v1)

begin;

-- Extend the transition trigger to honor a trusted-caller GUC.
create or replace function public.mentorship_pairs_enforce_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_caller uuid;
  v_trusted boolean;
begin
  v_caller := auth.uid();
  v_is_admin := public.has_active_role(new.organization_id, array['admin']);
  -- Trusted caller: set by admin_propose_pair() for SECURITY DEFINER paths
  -- that already validated the actor. Cleared at end of RPC body.
  begin
    v_trusted := coalesce(nullif(current_setting('app.mentorship_trusted_caller', true), ''), 'off') = 'on';
  exception when others then
    v_trusted := false;
  end;

  -- INSERT: only proposed rows from non-admin; trigger owns audit fields
  if tg_op = 'INSERT' and not v_is_admin and not v_trusted then
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

  if tg_op = 'UPDATE' and not v_is_admin and not v_trusted then
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

  if tg_op = 'UPDATE' and old.status is distinct from new.status and not v_is_admin and not v_trusted then
    if new.mentor_user_id = v_caller and old.status = 'proposed'
       and new.status = 'accepted' then
      new.accepted_at := now();
      new.declined_at := null;
      new.declined_reason := null;
    elsif new.mentor_user_id = v_caller and old.status = 'proposed'
          and new.status = 'declined' then
      new.accepted_at := null;
      new.declined_at := now();
    elsif new.mentee_user_id = v_caller and old.status = 'proposed'
          and new.status = 'declined' then
      new.accepted_at := null;
      new.declined_at := now();
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

  if tg_op = 'UPDATE' and old.status is not distinct from new.status and not v_is_admin and not v_trusted then
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

create or replace function public.admin_propose_pair(
  p_organization_id uuid,
  p_mentor_user_id uuid,
  p_mentee_user_id uuid,
  p_match_score numeric,
  p_match_signals jsonb,
  p_actor_user_id uuid default null
)
returns table (
  pair_id uuid,
  status text,
  match_score numeric,
  match_signals jsonb,
  reused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_mentee_self boolean;
  v_existing public.mentorship_pairs%rowtype;
  v_inserted public.mentorship_pairs%rowtype;
begin
  v_actor := coalesce(p_actor_user_id, auth.uid());

  if v_actor is null then
    raise exception 'actor_user_id required' using errcode = '42501';
  end if;

  v_is_admin := exists (
    select 1 from public.user_organization_roles
     where user_id = v_actor
       and organization_id = p_organization_id
       and role = 'admin'
       and status = 'active'
  );
  v_is_mentee_self := (v_actor = p_mentee_user_id) and exists (
    select 1 from public.user_organization_roles
     where user_id = v_actor
       and organization_id = p_organization_id
       and role = 'active_member'
       and status = 'active'
  );

  if not (v_is_admin or v_is_mentee_self) then
    raise exception 'actor % not permitted to propose pair in org %', v_actor, p_organization_id
      using errcode = '42501';
  end if;

  -- Idempotent
  select * into v_existing
    from public.mentorship_pairs
   where organization_id = p_organization_id
     and mentor_user_id = p_mentor_user_id
     and mentee_user_id = p_mentee_user_id
     and status in ('proposed','accepted','active','paused')
     and deleted_at is null
   limit 1;

  if found then
    return query select v_existing.id,
                        v_existing.status,
                        v_existing.match_score,
                        v_existing.match_signals,
                        true;
    return;
  end if;

  -- Trust-gate the transition trigger for this insert only.
  -- Concurrent callers may both pass the SELECT above; the unique index is the
  -- source of truth, so catch unique_violation and return the winner's row.
  perform set_config('app.mentorship_trusted_caller', 'on', true);

  begin
    insert into public.mentorship_pairs (
      organization_id,
      mentor_user_id,
      mentee_user_id,
      status,
      match_score,
      match_signals,
      proposed_by,
      proposed_at
    ) values (
      p_organization_id,
      p_mentor_user_id,
      p_mentee_user_id,
      'proposed',
      p_match_score,
      p_match_signals,
      v_actor,
      now()
    )
    returning * into v_inserted;
  exception
    when unique_violation then
      perform set_config('app.mentorship_trusted_caller', 'off', true);

      select * into v_existing
        from public.mentorship_pairs
       where organization_id = p_organization_id
         and mentor_user_id = p_mentor_user_id
         and mentee_user_id = p_mentee_user_id
         and status in ('proposed','accepted','active','paused')
         and deleted_at is null
       limit 1;

      if found then
        return query select v_existing.id,
                            v_existing.status,
                            v_existing.match_score,
                            v_existing.match_signals,
                            true;
        return;
      end if;

      raise;
    when others then
      perform set_config('app.mentorship_trusted_caller', 'off', true);
      raise;
  end;

  perform set_config('app.mentorship_trusted_caller', 'off', true);

  return query select v_inserted.id,
                      v_inserted.status,
                      v_inserted.match_score,
                      v_inserted.match_signals,
                      false;
end;
$$;

revoke all on function public.admin_propose_pair(uuid, uuid, uuid, numeric, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_propose_pair(uuid, uuid, uuid, numeric, jsonb, uuid) to service_role;

commit;
