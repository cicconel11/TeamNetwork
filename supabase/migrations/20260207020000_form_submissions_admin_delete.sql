-- Allow org admins to delete and update any form submission in their org.
--
-- Previously only the submitting user could update their own submission
-- (via "Users update own submissions") and no DELETE policy existed at all.
-- This migration adds admin-level UPDATE and DELETE so that org admins can
-- manage (e.g. remove or correct) form submissions on behalf of members.
--
-- Uses is_org_admin() helper consistent with the forms_admin_* policies
-- established in 20260421130000_performance_security_lint_fixes.sql.

begin;

-- Admin DELETE policy (no prior DELETE policy existed)
create policy form_submissions_admin_delete on public.form_submissions
  for delete
  using (is_org_admin(organization_id));

-- Admin UPDATE policy (supplements the user-level "Users update own submissions")
create policy form_submissions_admin_update on public.form_submissions
  for update
  using (is_org_admin(organization_id));

commit;
