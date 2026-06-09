-- Performance: wrap auth.uid()/auth.role() in (select ...) inside RLS policies so
-- Postgres evaluates them once per query (InitPlan) instead of once per row.
-- This is the optimization Supabase's performance advisor recommends
-- (auth_rls_initplan) and a prior migration (20260812000000_rls_initplan_auth_uid)
-- already applied to most policies; these 25 were missed. Semantics are identical
-- — only the query plan changes — so reads on these tables get faster at scale.

-- ── user_push_tokens ─────────────────────────────────────────────────────────
drop policy if exists user_push_tokens_select on public.user_push_tokens;
create policy user_push_tokens_select on public.user_push_tokens
  for select using ((select auth.uid()) = user_id);

drop policy if exists user_push_tokens_insert on public.user_push_tokens;
create policy user_push_tokens_insert on public.user_push_tokens
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists user_push_tokens_update on public.user_push_tokens;
create policy user_push_tokens_update on public.user_push_tokens
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists user_push_tokens_delete on public.user_push_tokens;
create policy user_push_tokens_delete on public.user_push_tokens
  for delete using ((select auth.uid()) = user_id);

-- ── user_onboarding_progress ─────────────────────────────────────────────────
drop policy if exists onboarding_progress_select on public.user_onboarding_progress;
create policy onboarding_progress_select on public.user_onboarding_progress
  for select using (user_id = (select auth.uid()));

drop policy if exists onboarding_progress_insert on public.user_onboarding_progress;
create policy onboarding_progress_insert on public.user_onboarding_progress
  for insert with check (user_id = (select auth.uid()));

drop policy if exists onboarding_progress_update on public.user_onboarding_progress;
create policy onboarding_progress_update on public.user_onboarding_progress
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists onboarding_progress_delete on public.user_onboarding_progress;
create policy onboarding_progress_delete on public.user_onboarding_progress
  for delete using (user_id = (select auth.uid()));

-- ── notification_reads ───────────────────────────────────────────────────────
drop policy if exists notification_reads_select_own on public.notification_reads;
create policy notification_reads_select_own on public.notification_reads
  for select using (user_id = (select auth.uid()));

drop policy if exists notification_reads_insert_own on public.notification_reads;
create policy notification_reads_insert_own on public.notification_reads
  for insert with check (user_id = (select auth.uid()));

drop policy if exists notification_reads_delete_own on public.notification_reads;
create policy notification_reads_delete_own on public.notification_reads
  for delete using (user_id = (select auth.uid()));

-- ── user_agreements (role: authenticated) ────────────────────────────────────
drop policy if exists user_agreements_select on public.user_agreements;
create policy user_agreements_select on public.user_agreements
  for select to authenticated using (user_id = (select auth.uid()));

-- ── ai_feedback ──────────────────────────────────────────────────────────────
drop policy if exists ai_feedback_select on public.ai_feedback;
create policy ai_feedback_select on public.ai_feedback
  for select using (exists (
    select 1 from public.ai_messages m
    join public.ai_threads t on t.id = m.thread_id
    where m.id = ai_feedback.message_id and t.user_id = (select auth.uid()) and t.deleted_at is null));

drop policy if exists ai_feedback_insert on public.ai_feedback;
create policy ai_feedback_insert on public.ai_feedback
  for insert with check ((user_id = (select auth.uid())) and exists (
    select 1 from public.ai_messages m
    join public.ai_threads t on t.id = m.thread_id
    where m.id = ai_feedback.message_id and t.user_id = (select auth.uid()) and t.deleted_at is null));

drop policy if exists ai_feedback_update on public.ai_feedback;
create policy ai_feedback_update on public.ai_feedback
  for update using (user_id = (select auth.uid()));

drop policy if exists ai_feedback_delete on public.ai_feedback;
create policy ai_feedback_delete on public.ai_feedback
  for delete using ((user_id = (select auth.uid())) and exists (
    select 1 from public.ai_messages m
    join public.ai_threads t on t.id = m.thread_id
    where m.id = ai_feedback.message_id and t.user_id = (select auth.uid()) and t.deleted_at is null));

-- ── ai_spend_ledger ──────────────────────────────────────────────────────────
drop policy if exists ai_spend_ledger_admin_select on public.ai_spend_ledger;
create policy ai_spend_ledger_admin_select on public.ai_spend_ledger
  for select using (exists (
    select 1 from public.user_organization_roles uor
    where uor.user_id = (select auth.uid()) and uor.organization_id = ai_spend_ledger.org_id
      and uor.role = 'admin'::user_role and uor.status = 'active'::membership_status));

-- ── org_member_role_audit (role: authenticated) ──────────────────────────────
drop policy if exists org_member_role_audit_admin_select on public.org_member_role_audit;
create policy org_member_role_audit_admin_select on public.org_member_role_audit
  for select to authenticated using (exists (
    select 1 from public.user_organization_roles uor
    where uor.organization_id = org_member_role_audit.organization_id and uor.user_id = (select auth.uid())
      and uor.role = 'admin'::user_role and uor.status = 'active'::membership_status));

-- ── discussion_replies_insert (only the flagged INSERT policy) ────────────────
drop policy if exists discussion_replies_insert on public.discussion_replies;
create policy discussion_replies_insert on public.discussion_replies
  for insert with check ((author_id = (select auth.uid()))
    and has_active_role(organization_id, array['admin','active_member','alumni','parent'])
    and exists (
      select 1 from public.discussion_threads
      where discussion_threads.id = discussion_replies.thread_id
        and discussion_threads.organization_id = discussion_replies.organization_id
        and discussion_threads.deleted_at is null and discussion_threads.is_locked = false));

-- ── enterprise_deletion_requests (service-role only) ─────────────────────────
drop policy if exists enterprise_deletion_requests_service_only on public.enterprise_deletion_requests;
create policy enterprise_deletion_requests_service_only on public.enterprise_deletion_requests
  for all using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

-- ── mentorship_pairs ─────────────────────────────────────────────────────────
drop policy if exists mentorship_pairs_select on public.mentorship_pairs;
create policy mentorship_pairs_select on public.mentorship_pairs
  for select using (has_active_role(organization_id, array['admin','active_member','alumni'])
    and (has_active_role(organization_id, array['admin'])
      or mentor_user_id = (select auth.uid())
      or mentee_user_id = (select auth.uid())));

drop policy if exists mentorship_pairs_insert_mentee on public.mentorship_pairs;
create policy mentorship_pairs_insert_mentee on public.mentorship_pairs
  for insert with check ((mentee_user_id = (select auth.uid())) and (status = 'proposed')
    and has_active_role(organization_id, array['active_member','alumni']));

drop policy if exists mentorship_pairs_insert_mentor on public.mentorship_pairs;
create policy mentorship_pairs_insert_mentor on public.mentorship_pairs
  for insert with check ((mentor_user_id = (select auth.uid())) and (status = 'proposed')
    and has_active_role(organization_id, array['alumni','active_member']));

drop policy if exists mentorship_pairs_update_mentee on public.mentorship_pairs;
create policy mentorship_pairs_update_mentee on public.mentorship_pairs
  for update using ((mentee_user_id = (select auth.uid()))
    and has_active_role(organization_id, array['active_member','alumni'])
    and (status = any (array['proposed','accepted','active'])) and (deleted_at is null))
  with check ((mentee_user_id = (select auth.uid())) and (status = any (array['declined','completed'])));

drop policy if exists mentorship_pairs_update_mentor on public.mentorship_pairs;
create policy mentorship_pairs_update_mentor on public.mentorship_pairs
  for update using ((mentor_user_id = (select auth.uid()))
    and has_active_role(organization_id, array['alumni','active_member'])
    and (status = 'proposed') and (deleted_at is null))
  with check ((mentor_user_id = (select auth.uid())) and (status = any (array['accepted','declined'])));
