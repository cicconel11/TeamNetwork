-- Fix high-risk RLS gaps:
-- 1) Restrict public.users visibility to self or users in shared active orgs.
-- 2) Prevent unrestricted row-shape updates on mentorship_logs.

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.user_organization_roles viewer_role
      join public.user_organization_roles target_role
        on target_role.organization_id = viewer_role.organization_id
      where viewer_role.user_id = (select auth.uid())
        and viewer_role.status = 'active'
        and target_role.user_id = users.id
        and target_role.status = 'active'
    )
  );

drop policy if exists mentorship_logs_update on public.mentorship_logs;
create policy mentorship_logs_update
  on public.mentorship_logs
  for update using (
    exists (
      select 1
      from public.mentorship_pairs mp
      where mp.id = mentorship_logs.pair_id
        and mp.organization_id = mentorship_logs.organization_id
        and (
          has_active_role(mp.organization_id, array['admin'])
          or (has_active_role(mp.organization_id, array['active_member']) and mentorship_logs.created_by = (select auth.uid()))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.mentorship_pairs mp
      where mp.id = mentorship_logs.pair_id
        and mp.organization_id = mentorship_logs.organization_id
        and (
          has_active_role(mp.organization_id, array['admin'])
          or (has_active_role(mp.organization_id, array['active_member']) and mentorship_logs.created_by = (select auth.uid()))
        )
    )
  );
