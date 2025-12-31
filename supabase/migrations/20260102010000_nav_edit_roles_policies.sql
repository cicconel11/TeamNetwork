-- Helper: determine if the current user can edit a page based on nav_config.editRoles (admins always allowed)
create or replace function public.can_edit_page(org_id uuid, path text)
returns boolean
language sql
stable
as $$
  select
    public.has_active_role(org_id, array['admin'])
    or exists (
      select 1
      from public.organizations o
      where o.id = org_id
      cross join lateral (
        select coalesce(o.nav_config -> path -> 'editRoles', '["admin"]'::jsonb) as roles
      ) cfg
      cross join lateral jsonb_array_elements_text(cfg.roles) as r(role)
      where
        (r.role = 'admin' and public.has_active_role(org_id, array['admin']))
        or (r.role = 'active_member' and public.has_active_role(org_id, array['active_member']))
        or (r.role = 'alumni' and public.has_active_role(org_id, array['alumni']))
    );
$$;

-- Donations policies (respect nav-configured edit roles)
drop policy if exists donations_insert on public.donations;
create policy donations_insert on public.donations
  for insert
  with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists donations_update on public.donations;
create policy donations_update on public.donations
  for update
  using (public.can_edit_page(organization_id, '/donations'))
  with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists donations_delete on public.donations;
create policy donations_delete on public.donations
  for delete using (public.can_edit_page(organization_id, '/donations'));

-- Donation embeds policies (use the same edit roles as donations page)
drop policy if exists org_donation_embeds_insert on public.org_donation_embeds;
create policy org_donation_embeds_insert on public.org_donation_embeds
  for insert with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists org_donation_embeds_update on public.org_donation_embeds;
create policy org_donation_embeds_update on public.org_donation_embeds
  for update
  using (public.can_edit_page(organization_id, '/donations'))
  with check (public.can_edit_page(organization_id, '/donations'));

drop policy if exists org_donation_embeds_delete on public.org_donation_embeds;
create policy org_donation_embeds_delete on public.org_donation_embeds
  for delete using (public.can_edit_page(organization_id, '/donations'));

-- Philanthropy events policies (respect nav-configured edit roles)
drop policy if exists philanthropy_events_insert on public.philanthropy_events;
create policy philanthropy_events_insert on public.philanthropy_events
  for insert with check (public.can_edit_page(organization_id, '/philanthropy'));

drop policy if exists philanthropy_events_update on public.philanthropy_events;
create policy philanthropy_events_update on public.philanthropy_events
  for update
  using (public.can_edit_page(organization_id, '/philanthropy'))
  with check (public.can_edit_page(organization_id, '/philanthropy'));

drop policy if exists philanthropy_events_delete on public.philanthropy_events;
create policy philanthropy_events_delete on public.philanthropy_events
  for delete using (public.can_edit_page(organization_id, '/philanthropy'));

-- Philanthropy embeds policies (use same edit roles as philanthropy page)
drop policy if exists org_philanthropy_embeds_insert on public.org_philanthropy_embeds;
create policy org_philanthropy_embeds_insert on public.org_philanthropy_embeds
  for insert with check (public.can_edit_page(organization_id, '/philanthropy'));

drop policy if exists org_philanthropy_embeds_update on public.org_philanthropy_embeds;
create policy org_philanthropy_embeds_update on public.org_philanthropy_embeds
  for update
  using (public.can_edit_page(organization_id, '/philanthropy'))
  with check (public.can_edit_page(organization_id, '/philanthropy'));

drop policy if exists org_philanthropy_embeds_delete on public.org_philanthropy_embeds;
create policy org_philanthropy_embeds_delete on public.org_philanthropy_embeds
  for delete using (public.can_edit_page(organization_id, '/philanthropy'));
