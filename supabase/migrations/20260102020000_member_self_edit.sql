-- Allow members and alumni to edit their own profiles while keeping admin control

-- Members: admins OR the user owning the profile (with an active/alumni/admin role in the org)
drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update
  using (
    public.is_org_admin(organization_id)
    or (
      user_id = auth.uid()
      and public.has_active_role(organization_id, array['admin','active_member','alumni'])
    )
  )
  with check (
    public.is_org_admin(organization_id)
    or (
      user_id = auth.uid()
      and public.has_active_role(organization_id, array['admin','active_member','alumni'])
    )
  );

-- Alumni: admins OR the user owning the profile (with an active/alumni/admin role in the org)
drop policy if exists alumni_update on public.alumni;
create policy alumni_update on public.alumni
  for update
  using (
    public.is_org_admin(organization_id)
    or (
      user_id = auth.uid()
      and public.has_active_role(organization_id, array['admin','active_member','alumni'])
    )
  )
  with check (
    public.is_org_admin(organization_id)
    or (
      user_id = auth.uid()
      and public.has_active_role(organization_id, array['admin','active_member','alumni'])
    )
  );
