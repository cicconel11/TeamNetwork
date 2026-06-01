-- Fix ON DELETE actions on FKs referencing auth.users, public.users, and public.organizations
-- so GDPR user-deletion and organization-deletion succeed without FK violations.
--
-- WHY: account deletion (api/cron/account-deletion) calls auth.admin.deleteUser() and relies
-- 100% on FK cascade through public.users. Many child FKs were ON DELETE NO ACTION, which
-- aborts the delete. Most critically members_user_id_fkey was NO ACTION with 203 linked rows,
-- so deleting any real member's account FK-violated. Org deletion uses app-side ordering
-- (lib/subscription/delete-organization.ts) but its DELETION_ORDER omits ai_pending_actions
-- and dsr_requests, so those org FKs are made self-sufficient here too.
--
-- POLICY:
--   * organization_id FKs  -> ON DELETE CASCADE  (org-owned content dies with the org)
--   * user/actor FKs that are personal to the user -> CASCADE
--   * author/actor FKs on org-owned content -> SET NULL (anonymize, preserve content history)
--   * 6 author/actor columns are NOT NULL today; SET NULL requires DROP NOT NULL first.
--
-- Idempotent: each FK is dropped IF EXISTS then re-added. Safe to re-run.

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Columns that must become nullable so ON DELETE SET NULL is legal.
--    (anonymize-on-delete: keep the row, blank the author/actor)
-- ----------------------------------------------------------------------------
ALTER TABLE public.discussion_replies            ALTER COLUMN author_id          DROP NOT NULL;
ALTER TABLE public.discussion_threads            ALTER COLUMN author_id          DROP NOT NULL;
ALTER TABLE public.job_postings                  ALTER COLUMN posted_by          DROP NOT NULL;
ALTER TABLE public.enterprise_adoption_requests  ALTER COLUMN requested_by       DROP NOT NULL;
ALTER TABLE public.enterprise_invites            ALTER COLUMN created_by_user_id DROP NOT NULL;
ALTER TABLE public.parent_invites                ALTER COLUMN invited_by         DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. FKs -> public.organizations : CASCADE (org-owned content removed with org)
-- ----------------------------------------------------------------------------
ALTER TABLE public.academic_schedules        DROP CONSTRAINT IF EXISTS academic_schedules_organization_id_fkey,
  ADD CONSTRAINT academic_schedules_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.ai_pending_actions        DROP CONSTRAINT IF EXISTS ai_pending_actions_org_id_fkey,
  ADD CONSTRAINT ai_pending_actions_org_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.discussion_replies        DROP CONSTRAINT IF EXISTS discussion_replies_organization_id_fkey,
  ADD CONSTRAINT discussion_replies_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.discussion_threads        DROP CONSTRAINT IF EXISTS discussion_threads_organization_id_fkey,
  ADD CONSTRAINT discussion_threads_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.dsr_requests              DROP CONSTRAINT IF EXISTS dsr_requests_organization_id_fkey,
  ADD CONSTRAINT dsr_requests_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.form_document_submissions DROP CONSTRAINT IF EXISTS form_document_submissions_organization_id_fkey,
  ADD CONSTRAINT form_document_submissions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.form_documents            DROP CONSTRAINT IF EXISTS form_documents_organization_id_fkey,
  ADD CONSTRAINT form_documents_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.form_submissions          DROP CONSTRAINT IF EXISTS form_submissions_organization_id_fkey,
  ADD CONSTRAINT form_submissions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.forms                     DROP CONSTRAINT IF EXISTS forms_organization_id_fkey,
  ADD CONSTRAINT forms_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.job_postings              DROP CONSTRAINT IF EXISTS job_postings_organization_id_fkey,
  ADD CONSTRAINT job_postings_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.mentor_profiles           DROP CONSTRAINT IF EXISTS mentor_profiles_organization_id_fkey,
  ADD CONSTRAINT mentor_profiles_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.payment_attempts          DROP CONSTRAINT IF EXISTS payment_attempts_organization_id_fkey,
  ADD CONSTRAINT payment_attempts_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_files            DROP CONSTRAINT IF EXISTS schedule_files_organization_id_fkey,
  ADD CONSTRAINT schedule_files_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 3. FKs -> public.users
-- ----------------------------------------------------------------------------
-- CASCADE: row is personal to the user (their own submission / their own profile)
ALTER TABLE public.form_document_submissions DROP CONSTRAINT IF EXISTS form_document_submissions_user_id_fkey,
  ADD CONSTRAINT form_document_submissions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.mentor_profiles           DROP CONSTRAINT IF EXISTS mentor_profiles_user_id_fkey,
  ADD CONSTRAINT mentor_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- SET NULL: org-owned content authored by the user (anonymize, keep content)
ALTER TABLE public.discussion_replies        DROP CONSTRAINT IF EXISTS discussion_replies_author_id_fkey,
  ADD CONSTRAINT discussion_replies_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.discussion_threads        DROP CONSTRAINT IF EXISTS discussion_threads_author_id_fkey,
  ADD CONSTRAINT discussion_threads_author_id_fkey
  FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.event_rsvps               DROP CONSTRAINT IF EXISTS event_rsvps_checked_in_by_fkey,
  ADD CONSTRAINT event_rsvps_checked_in_by_fkey
  FOREIGN KEY (checked_in_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.form_documents            DROP CONSTRAINT IF EXISTS form_documents_created_by_fkey,
  ADD CONSTRAINT form_documents_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.forms                     DROP CONSTRAINT IF EXISTS forms_created_by_fkey,
  ADD CONSTRAINT forms_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.job_postings              DROP CONSTRAINT IF EXISTS job_postings_posted_by_fkey,
  ADD CONSTRAINT job_postings_posted_by_fkey
  FOREIGN KEY (posted_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 4. FKs -> auth.users
-- ----------------------------------------------------------------------------
-- CASCADE: row is personal to the user (their own pending AI action)
ALTER TABLE public.ai_pending_actions        DROP CONSTRAINT IF EXISTS ai_pending_actions_user_id_fkey,
  ADD CONSTRAINT ai_pending_actions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- SET NULL: membership / actor / audit columns (anonymize, keep the row)
ALTER TABLE public.members                   DROP CONSTRAINT IF EXISTS members_user_id_fkey,
  ADD CONSTRAINT members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.alumni                    DROP CONSTRAINT IF EXISTS alumni_user_id_fkey,
  ADD CONSTRAINT alumni_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.calendar_feeds            DROP CONSTRAINT IF EXISTS calendar_feeds_connected_user_id_fkey,
  ADD CONSTRAINT calendar_feeds_connected_user_id_fkey
  FOREIGN KEY (connected_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.competition_points        DROP CONSTRAINT IF EXISTS competition_points_created_by_fkey,
  ADD CONSTRAINT competition_points_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.enterprise_adoption_requests DROP CONSTRAINT IF EXISTS enterprise_adoption_requests_requested_by_fkey,
  ADD CONSTRAINT enterprise_adoption_requests_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.enterprise_adoption_requests DROP CONSTRAINT IF EXISTS enterprise_adoption_requests_responded_by_fkey,
  ADD CONSTRAINT enterprise_adoption_requests_responded_by_fkey
  FOREIGN KEY (responded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.enterprise_invites        DROP CONSTRAINT IF EXISTS enterprise_invites_created_by_user_id_fkey,
  ADD CONSTRAINT enterprise_invites_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.organization_invites      DROP CONSTRAINT IF EXISTS organization_invites_created_by_user_id_fkey,
  ADD CONSTRAINT organization_invites_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.parent_invites            DROP CONSTRAINT IF EXISTS parent_invites_invited_by_fkey,
  ADD CONSTRAINT parent_invites_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.payment_attempts          DROP CONSTRAINT IF EXISTS payment_attempts_user_id_fkey,
  ADD CONSTRAINT payment_attempts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.workouts                  DROP CONSTRAINT IF EXISTS workouts_created_by_fkey,
  ADD CONSTRAINT workouts_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
