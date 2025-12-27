-- Allow mentors to manage their own mentee pairing and mentees to self-toggle availability

-- Mentorship pairs: allow admins (existing) and mentors (alumni) to insert/update/delete their own pair rows
drop policy if exists mentorship_pairs_insert on public.mentorship_pairs;
create policy mentorship_pairs_insert
  on public.mentorship_pairs
  for insert
  with check (
    has_active_role(organization_id, array['admin'])
    or (
      has_active_role(organization_id, array['alumni'])
      and mentor_user_id = auth.uid()
    )
  );

drop policy if exists mentorship_pairs_update on public.mentorship_pairs;
create policy mentorship_pairs_update
  on public.mentorship_pairs
  for update
  using (
    has_active_role(organization_id, array['admin'])
    or (
      has_active_role(organization_id, array['alumni'])
      and mentor_user_id = auth.uid()
    )
  )
  with check (
    has_active_role(organization_id, array['admin'])
    or (
      has_active_role(organization_id, array['alumni'])
      and mentor_user_id = auth.uid()
    )
  );

drop policy if exists mentorship_pairs_delete on public.mentorship_pairs;
create policy mentorship_pairs_delete
  on public.mentorship_pairs
  for delete
  using (
    has_active_role(organization_id, array['admin'])
    or (
      has_active_role(organization_id, array['alumni'])
      and mentor_user_id = auth.uid()
    )
  );

-- Memberships: allow self-service status toggling for active members/alumni while keeping admin control
drop policy if exists user_org_roles_update on public.user_organization_roles;
create policy user_org_roles_update_admin on public.user_organization_roles
  for update using (has_active_role(organization_id, array['admin']))
  with check (true);

create policy user_org_roles_self_update on public.user_organization_roles
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and role = any (array['active_member','alumni'])
    and status = any (array['active','revoked','pending'])
  );
