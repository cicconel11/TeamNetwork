-- Fix: admin_propose_pair threw "column reference \"status\" is ambiguous".
--
-- The function's RETURNS TABLE(..., status text, ...) declares an OUT column
-- named `status` that collides with the `status` columns referenced in its
-- body (user_organization_roles.status, mentorship_pairs.status). PL/pgSQL
-- could not disambiguate, so EVERY call raised 42702 — breaking admin
-- run-rounds, mentee self-requests, and the new admin pairing-surface confirm.
--
-- Fix: add `#variable_conflict use_column` so bare `status` resolves to the
-- table column. The OUT params are only ever populated positionally via
-- `return query select ...`, never read by name, so this is safe and does not
-- change behavior beyond removing the ambiguity error.
--
-- Idempotent: CREATE OR REPLACE.
begin;

create or replace function public.admin_propose_pair(
  p_organization_id uuid,
  p_mentor_user_id uuid,
  p_mentee_user_id uuid,
  p_match_score numeric,
  p_match_signals jsonb,
  p_actor_user_id uuid default null::uuid
)
returns table (pair_id uuid, status text, match_score numeric, match_signals jsonb, reused boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_actor uuid;
  v_is_admin boolean;
  v_is_mentee_self boolean;
  v_existing public.mentorship_pairs%rowtype;
  v_inserted public.mentorship_pairs%rowtype;
begin
  v_actor := coalesce(p_actor_user_id, auth.uid());
  if v_actor is null then raise exception 'actor_user_id required' using errcode = '42501'; end if;

  v_is_admin := exists (
    select 1 from public.user_organization_roles
     where user_id = v_actor and organization_id = p_organization_id
       and role = 'admin' and status = 'active'
  );
  v_is_mentee_self := (v_actor = p_mentee_user_id) and exists (
    select 1 from public.user_organization_roles
     where user_id = v_actor and organization_id = p_organization_id
       and role = 'active_member' and status = 'active'
  );

  if not (v_is_admin or v_is_mentee_self) then
    raise exception 'actor % not permitted to propose pair in org %', v_actor, p_organization_id
      using errcode = '42501';
  end if;

  select * into v_existing
    from public.mentorship_pairs
   where organization_id = p_organization_id
     and mentor_user_id = p_mentor_user_id
     and mentee_user_id = p_mentee_user_id
     and status in ('proposed','accepted','active','paused')
     and deleted_at is null
   limit 1;

  if found then
    return query select v_existing.id, v_existing.status, v_existing.match_score, v_existing.match_signals, true;
    return;
  end if;

  perform set_config('app.mentorship_trusted_caller', 'on', true);

  begin
    insert into public.mentorship_pairs (
      organization_id, mentor_user_id, mentee_user_id, status,
      match_score, match_signals, proposed_by, proposed_at
    ) values (
      p_organization_id, p_mentor_user_id, p_mentee_user_id, 'proposed',
      p_match_score, p_match_signals, v_actor, now()
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
        return query select v_existing.id, v_existing.status, v_existing.match_score, v_existing.match_signals, true;
        return;
      end if;
      raise;
    when others then
      perform set_config('app.mentorship_trusted_caller', 'off', true);
      raise;
  end;

  perform set_config('app.mentorship_trusted_caller', 'off', true);

  return query select v_inserted.id, v_inserted.status, v_inserted.match_score, v_inserted.match_signals, false;
end;
$function$;

commit;
