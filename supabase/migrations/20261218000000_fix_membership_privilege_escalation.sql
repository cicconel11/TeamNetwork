-- Fix two critical privilege-escalation vulnerabilities.
--
-- CRITICAL #1 — Self-service membership escalation on user_organization_roles.
--   The INSERT RLS policy only checked `user_id = auth.uid()` (no role/status/org
--   constraint) and the UPDATE policy's WITH CHECK allowed a user to set their own
--   row to status='active'. Because `authenticated` holds direct INSERT/UPDATE
--   grants and PostgREST exposes the table, any logged-in user could:
--     * POST a row { user_id: self, organization_id: <any org>, role: 'admin',
--       status: 'active' } and become admin of an arbitrary organization, or
--     * PATCH their own pending row to status='active' (bypassing admin approval),
--       or move it to another org (organization_id was not pinned).
--
--   RLS WITH CHECK cannot express "status did not change" (it cannot see the OLD
--   row), so a pure-policy fix would break legitimate status-preserving self
--   updates (e.g. feed_last_seen_at while still 'active'). Instead we add a
--   BEFORE INSERT/UPDATE trigger that enforces the real invariants and only
--   applies to direct end-user writes (current_user = 'authenticated' / 'anon').
--   Service-role writes and SECURITY DEFINER RPCs (owned by 'postgres', e.g.
--   redeem_org_invite) run under a different role and are intentionally exempt.
--
-- CRITICAL #2 — Anon-executable SECURITY DEFINER write functions.
--   bulk_import_linkedin_alumni, enrich_alumni_by_id and save_user_linkedin_url
--   are SECURITY DEFINER (RLS-bypassing), take a caller-supplied org_id / user_id,
--   perform no caller-identity check, and were EXECUTE-granted to anon +
--   authenticated. Anyone could call them unauthenticated via /rest/v1/rpc/... to
--   write alumni/member rows across any tenant. The app only ever invokes them
--   through the service-role client, so we revoke direct anon/authenticated access.

-- ─────────────────────────────────────────────────────────────────────────────
-- Part 1: membership self-service guard
-- ─────────────────────────────────────────────────────────────────────────────

-- NB: SECURITY INVOKER is required. The whole guard hinges on current_user
-- reflecting the *actual* role performing the write. Under SECURITY DEFINER,
-- current_user would be the function owner ('postgres') and the bypass below
-- would always fire, silently disabling the trigger.
create or replace function public.enforce_user_org_role_self_service()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  -- Only direct PostgREST writes by end users run as 'authenticated'/'anon'.
  -- The service-role client, SECURITY DEFINER RPCs (run as their owner 'postgres'),
  -- and migrations run under other roles and are trusted to set membership freely.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  v_uid := (select auth.uid());

  -- Org admins may manage any membership row in their own org (approve pending
  -- members, change roles, revoke). This is what the web/mobile admin tools use.
  if v_uid is not null and public.is_org_admin(new.organization_id) then
    return new;
  end if;

  -- Past this point the caller is a non-admin end user: they may only act on
  -- their OWN membership row.
  if v_uid is null or new.user_id <> v_uid then
    raise exception 'not authorized to modify membership for another user'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    -- A user may only create a pending join request for a non-privileged role.
    -- Activation requires admin approval or a SECURITY DEFINER invite RPC.
    if new.role::text = 'admin' or new.status::text <> 'pending' then
      raise exception 'cannot self-grant elevated or active membership'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE': the user may not move the row to another org/user, may not
  -- change their own role, and may not self-approve. The only status transition
  -- they may make is leaving the org (-> 'revoked'). Status-preserving updates
  -- (e.g. feed_last_seen_at while still 'active') stay allowed.
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
    raise exception 'cannot move your membership to another org or user'
      using errcode = '42501';
  end if;

  if new.role::text <> old.role::text then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;

  if new.status::text <> old.status::text and new.status::text <> 'revoked' then
    raise exception 'cannot self-approve membership; admin approval required'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- A SECURITY INVOKER trigger function executes under the firing role, so end
-- users need EXECUTE for it to fire. This is safe: functions returning `trigger`
-- are not callable directly and are not exposed via PostgREST RPC.
grant execute on function public.enforce_user_org_role_self_service() to authenticated, anon;

drop trigger if exists enforce_user_org_role_self_service on public.user_organization_roles;
create trigger enforce_user_org_role_self_service
  before insert or update on public.user_organization_roles
  for each row execute function public.enforce_user_org_role_self_service();

-- ─────────────────────────────────────────────────────────────────────────────
-- Part 2: revoke anon/authenticated EXECUTE on the cross-tenant write RPCs.
-- These are only ever invoked by the server's service-role client.
-- ─────────────────────────────────────────────────────────────────────────────

-- NB: must revoke from PUBLIC as well — Postgres grants EXECUTE to PUBLIC by
-- default, which anon/authenticated inherit even after an explicit role revoke.
revoke execute on function public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.bulk_import_linkedin_alumni(uuid, jsonb, boolean) to service_role;

revoke execute on function public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.enrich_alumni_by_id(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, text, jsonb, jsonb, jsonb) to service_role;

revoke execute on function public.save_user_linkedin_url(uuid, text) from public, anon, authenticated;
grant execute on function public.save_user_linkedin_url(uuid, text) to service_role;
