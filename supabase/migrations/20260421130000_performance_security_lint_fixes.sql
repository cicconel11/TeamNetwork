-- Performance + security lints (Supabase advisor)
--
-- Codifies production changes applied via SQL editor:
-- - Avoid per-row auth.* evaluation in RLS policies by using (select auth.*())
-- - Merge duplicate permissive policies where possible
-- - Fix incorrectly-typed policy expenses_delete (was FOR UPDATE)
-- - Remove duplicate indexes and add missing partial index

begin;

-- Duplicate indexes flagged by advisor
drop index if exists public.org_donations_org_idx;
drop index if exists public.org_donations_pi_idx;

-- Future-proof members listing (soft delete)
create index if not exists members_org_not_deleted_idx
  on public.members (organization_id)
  where deleted_at is null;

-- ----------------------------
-- expenses: fix policy bug + initplan
-- ----------------------------

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete
  using (
    has_active_role(organization_id, array['admin'::text, 'active_member'::text])
    and (
      (user_id = (select auth.uid()))
      or has_active_role(organization_id, array['admin'::text])
    )
  );

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert
  with check (
    has_active_role(organization_id, array['admin'::text, 'active_member'::text])
    and (user_id = (select auth.uid()))
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update
  using (
    has_active_role(organization_id, array['admin'::text, 'active_member'::text])
    and ((user_id = (select auth.uid())) or has_active_role(organization_id, array['admin'::text]))
  );

-- ----------------------------
-- user_calendar_connections: initplan
-- ----------------------------

drop policy if exists user_calendar_connections_select on public.user_calendar_connections;
create policy user_calendar_connections_select on public.user_calendar_connections
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists user_calendar_connections_insert on public.user_calendar_connections;
create policy user_calendar_connections_insert on public.user_calendar_connections
  for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists user_calendar_connections_update on public.user_calendar_connections;
create policy user_calendar_connections_update on public.user_calendar_connections
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_calendar_connections_delete on public.user_calendar_connections;
create policy user_calendar_connections_delete on public.user_calendar_connections
  for delete
  using ((select auth.uid()) = user_id);

-- ----------------------------
-- calendar_sync_preferences: initplan
-- ----------------------------

drop policy if exists calendar_sync_preferences_select on public.calendar_sync_preferences;
create policy calendar_sync_preferences_select on public.calendar_sync_preferences
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists calendar_sync_preferences_insert on public.calendar_sync_preferences;
create policy calendar_sync_preferences_insert on public.calendar_sync_preferences
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
  );

drop policy if exists calendar_sync_preferences_update on public.calendar_sync_preferences;
create policy calendar_sync_preferences_update on public.calendar_sync_preferences
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists calendar_sync_preferences_delete on public.calendar_sync_preferences;
create policy calendar_sync_preferences_delete on public.calendar_sync_preferences
  for delete
  using ((select auth.uid()) = user_id);

-- ----------------------------
-- event_calendar_entries: initplan
-- ----------------------------

drop policy if exists event_calendar_entries_select on public.event_calendar_entries;
create policy event_calendar_entries_select on public.event_calendar_entries
  for select
  using (((select auth.uid()) = user_id) or has_active_role(organization_id, array['admin'::text]));

drop policy if exists event_calendar_entries_insert on public.event_calendar_entries;
create policy event_calendar_entries_insert on public.event_calendar_entries
  for insert
  with check (((select auth.uid()) = user_id) or has_active_role(organization_id, array['admin'::text]));

drop policy if exists event_calendar_entries_update on public.event_calendar_entries;
create policy event_calendar_entries_update on public.event_calendar_entries
  for update
  using (((select auth.uid()) = user_id) or has_active_role(organization_id, array['admin'::text]))
  with check (((select auth.uid()) = user_id) or has_active_role(organization_id, array['admin'::text]));

drop policy if exists event_calendar_entries_delete on public.event_calendar_entries;
create policy event_calendar_entries_delete on public.event_calendar_entries
  for delete
  using (((select auth.uid()) = user_id) or has_active_role(organization_id, array['admin'::text]));

-- ----------------------------
-- event_rsvps: initplan
-- ----------------------------

drop policy if exists event_rsvps_insert on public.event_rsvps;
create policy event_rsvps_insert on public.event_rsvps
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
  );

drop policy if exists event_rsvps_update on public.event_rsvps;
create policy event_rsvps_update on public.event_rsvps
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists event_rsvps_delete on public.event_rsvps;
create policy event_rsvps_delete on public.event_rsvps
  for delete
  using ((select auth.uid()) = user_id);

-- ----------------------------
-- academic_schedules: initplan + merge SELECT policies
-- ----------------------------

drop policy if exists "Admins can view org schedules" on public.academic_schedules;
drop policy if exists "Users can view own schedules" on public.academic_schedules;
drop policy if exists academic_schedules_select on public.academic_schedules;
create policy academic_schedules_select on public.academic_schedules
  for select
  using (((select auth.uid()) = user_id) or is_org_admin(organization_id));

drop policy if exists "Users can insert own schedules" on public.academic_schedules;
create policy "Users can insert own schedules" on public.academic_schedules
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and exists (
      select 1
      from public.user_organization_roles
      where user_organization_roles.user_id = (select auth.uid())
        and user_organization_roles.organization_id = academic_schedules.organization_id
        and user_organization_roles.status = 'active'::membership_status
    )
  );

drop policy if exists "Users can update own schedules" on public.academic_schedules;
create policy "Users can update own schedules" on public.academic_schedules
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own schedules" on public.academic_schedules;
create policy "Users can delete own schedules" on public.academic_schedules
  for delete
  using ((select auth.uid()) = user_id);

-- ----------------------------
-- schedule_files: initplan + merge SELECT policies
-- ----------------------------

drop policy if exists "Admins can view org files" on public.schedule_files;
drop policy if exists "Users can view own files" on public.schedule_files;
drop policy if exists schedule_files_select on public.schedule_files;
create policy schedule_files_select on public.schedule_files
  for select
  using (((select auth.uid()) = user_id) or is_org_admin(organization_id));

drop policy if exists "Users can insert own files" on public.schedule_files;
create policy "Users can insert own files" on public.schedule_files
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and exists (
      select 1
      from public.user_organization_roles
      where user_organization_roles.user_id = (select auth.uid())
        and user_organization_roles.organization_id = schedule_files.organization_id
        and user_organization_roles.status = 'active'::membership_status
    )
  );

drop policy if exists "Users can update own files" on public.schedule_files;
create policy "Users can update own files" on public.schedule_files
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own files" on public.schedule_files;
create policy "Users can delete own files" on public.schedule_files
  for delete
  using ((select auth.uid()) = user_id);

-- ----------------------------
-- form_submissions: initplan + merge SELECT policies
-- ----------------------------

drop policy if exists "Admins view org submissions" on public.form_submissions;
drop policy if exists "Users view own submissions" on public.form_submissions;
drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select
  using (((select auth.uid()) = user_id) or is_org_admin(organization_id));

drop policy if exists "Users can submit forms" on public.form_submissions;
create policy "Users can submit forms" on public.form_submissions
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and exists (
      select 1
      from public.user_organization_roles
      where user_organization_roles.user_id = (select auth.uid())
        and user_organization_roles.organization_id = form_submissions.organization_id
        and user_organization_roles.status = 'active'::membership_status
    )
  );

drop policy if exists "Users update own submissions" on public.form_submissions;
create policy "Users update own submissions" on public.form_submissions
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ----------------------------
-- form_document_submissions: initplan + merge SELECT policies
-- ----------------------------

drop policy if exists "Admins view org document submissions" on public.form_document_submissions;
drop policy if exists "Users view own document submissions" on public.form_document_submissions;
drop policy if exists form_document_submissions_select on public.form_document_submissions;
create policy form_document_submissions_select on public.form_document_submissions
  for select
  using (((select auth.uid()) = user_id) or is_org_admin(organization_id));

drop policy if exists "Users can submit documents" on public.form_document_submissions;
create policy "Users can submit documents" on public.form_document_submissions
  for insert
  with check (
    ((select auth.uid()) = user_id)
    and exists (
      select 1
      from public.user_organization_roles
      where user_organization_roles.user_id = (select auth.uid())
        and user_organization_roles.organization_id = form_document_submissions.organization_id
        and user_organization_roles.status = 'active'::membership_status
    )
  );

-- ----------------------------
-- forms: initplan + avoid multiple permissive SELECT
-- ----------------------------

drop policy if exists "Admins manage forms" on public.forms;
drop policy if exists "Members view active forms" on public.forms;
drop policy if exists forms_select on public.forms;
create policy forms_select on public.forms
  for select
  using (
    is_org_admin(organization_id)
    or (
      is_active = true
      and deleted_at is null
      and exists (
        select 1
        from public.user_organization_roles
        where user_organization_roles.user_id = (select auth.uid())
          and user_organization_roles.organization_id = forms.organization_id
          and user_organization_roles.status = 'active'::membership_status
      )
    )
  );

-- Write policies are split to avoid SELECT duplication.
drop policy if exists forms_admin_manage on public.forms;
drop policy if exists forms_admin_insert on public.forms;
drop policy if exists forms_admin_update on public.forms;
drop policy if exists forms_admin_delete on public.forms;

create policy forms_admin_insert on public.forms
  for insert
  with check (is_org_admin(organization_id));

create policy forms_admin_update on public.forms
  for update
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

create policy forms_admin_delete on public.forms
  for delete
  using (is_org_admin(organization_id));

-- ----------------------------
-- form_documents: initplan + avoid multiple permissive SELECT
-- ----------------------------

drop policy if exists "Admins manage form documents" on public.form_documents;
drop policy if exists "Members view active form documents" on public.form_documents;
drop policy if exists form_documents_select on public.form_documents;
create policy form_documents_select on public.form_documents
  for select
  using (
    is_org_admin(organization_id)
    or (
      is_active = true
      and deleted_at is null
      and exists (
        select 1
        from public.user_organization_roles
        where user_organization_roles.user_id = (select auth.uid())
          and user_organization_roles.organization_id = form_documents.organization_id
          and user_organization_roles.status = 'active'::membership_status
      )
    )
  );

-- Write policies are split to avoid SELECT duplication.
drop policy if exists form_documents_admin_manage on public.form_documents;
drop policy if exists form_documents_admin_insert on public.form_documents;
drop policy if exists form_documents_admin_update on public.form_documents;
drop policy if exists form_documents_admin_delete on public.form_documents;

create policy form_documents_admin_insert on public.form_documents
  for insert
  with check (is_org_admin(organization_id));

create policy form_documents_admin_update on public.form_documents
  for update
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

create policy form_documents_admin_delete on public.form_documents
  for delete
  using (is_org_admin(organization_id));

-- ----------------------------
-- members / alumni: initplan
-- ----------------------------

drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update
  using (
    is_org_admin(organization_id)
    or (
      (user_id = (select auth.uid()))
      and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  )
  with check (
    is_org_admin(organization_id)
    or (
      (user_id = (select auth.uid()))
      and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  );

drop policy if exists alumni_update on public.alumni;
create policy alumni_update on public.alumni
  for update
  using (
    is_org_admin(organization_id)
    or (
      (user_id = (select auth.uid()))
      and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  )
  with check (
    is_org_admin(organization_id)
    or (
      (user_id = (select auth.uid()))
      and has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
    )
  );

-- ----------------------------
-- mentorship_pairs: initplan
-- ----------------------------

drop policy if exists mentorship_pairs_delete on public.mentorship_pairs;
create policy mentorship_pairs_delete on public.mentorship_pairs
  for delete
  using (
    has_active_role(organization_id, array['admin'::text])
    or (
      has_active_role(organization_id, array['alumni'::text])
      and mentor_user_id = (select auth.uid())
    )
  );

drop policy if exists mentorship_pairs_insert on public.mentorship_pairs;
create policy mentorship_pairs_insert on public.mentorship_pairs
  for insert
  with check (
    has_active_role(organization_id, array['admin'::text])
    or (
      has_active_role(organization_id, array['alumni'::text])
      and mentor_user_id = (select auth.uid())
    )
  );

drop policy if exists mentorship_pairs_update on public.mentorship_pairs;
create policy mentorship_pairs_update on public.mentorship_pairs
  for update
  using (
    has_active_role(organization_id, array['admin'::text])
    or (
      has_active_role(organization_id, array['alumni'::text])
      and mentor_user_id = (select auth.uid())
    )
  )
  with check (
    has_active_role(organization_id, array['admin'::text])
    or (
      has_active_role(organization_id, array['alumni'::text])
      and mentor_user_id = (select auth.uid())
    )
  );

-- ----------------------------
-- payment_attempts / stripe_events: initplan
-- ----------------------------

drop policy if exists payment_attempts_service_only on public.payment_attempts;
create policy payment_attempts_service_only on public.payment_attempts
  for all
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

drop policy if exists stripe_events_service_only on public.stripe_events;
create policy stripe_events_service_only on public.stripe_events
  for all
  using ((select auth.role()) = 'service_role'::text)
  with check ((select auth.role()) = 'service_role'::text);

-- ----------------------------
-- user_organization_roles: initplan + merge UPDATE policies
-- ----------------------------

drop policy if exists user_org_roles_self_update on public.user_organization_roles;
drop policy if exists user_org_roles_update_admin on public.user_organization_roles;
drop policy if exists user_organization_roles_update on public.user_organization_roles;

create policy user_organization_roles_update on public.user_organization_roles
  for update
  using ((user_id = (select auth.uid())) or is_org_admin(organization_id))
  with check (
    is_org_admin(organization_id)
    or (
      (user_id = (select auth.uid()))
      and (role = any (array['active_member'::user_role, 'alumni'::user_role]))
      and (status = any (array['active'::membership_status, 'revoked'::membership_status, 'pending'::membership_status]))
    )
  );

-- ----------------------------
-- organization_donation_stats: avoid multiple permissive SELECT
-- ----------------------------

drop policy if exists organization_donation_stats_select on public.organization_donation_stats;
drop policy if exists organization_donation_stats_upsert on public.organization_donation_stats;
drop policy if exists organization_donation_stats_modify on public.organization_donation_stats;

create policy organization_donation_stats_select on public.organization_donation_stats
  for select
  using (
    has_active_role(organization_id, array['admin'::text, 'active_member'::text, 'alumni'::text])
    or can_edit_page(organization_id, '/donations'::text)
  );

drop policy if exists organization_donation_stats_insert on public.organization_donation_stats;
drop policy if exists organization_donation_stats_update on public.organization_donation_stats;
drop policy if exists organization_donation_stats_delete on public.organization_donation_stats;

create policy organization_donation_stats_insert on public.organization_donation_stats
  for insert
  with check (can_edit_page(organization_id, '/donations'::text));

create policy organization_donation_stats_update on public.organization_donation_stats
  for update
  using (can_edit_page(organization_id, '/donations'::text))
  with check (can_edit_page(organization_id, '/donations'::text));

create policy organization_donation_stats_delete on public.organization_donation_stats
  for delete
  using (can_edit_page(organization_id, '/donations'::text));

commit;
