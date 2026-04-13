-- Phase 0: Fix foreign key constraints that block auth.admin.deleteUser()
--
-- Problem: 6 tables have bare REFERENCES (NO ACTION / RESTRICT) that cause
-- FK violations when deleting a user from auth.users.
--
-- Cascade chain: auth.users → public.users (already CASCADE) → these tables.
-- For tables referencing auth.users directly, the delete triggers the FK check directly.

-- 1. academic_schedules.user_id → public.users(id): RESTRICT → CASCADE
--    Schedule data belongs to the user and should be removed with them.
ALTER TABLE public.academic_schedules
  DROP CONSTRAINT academic_schedules_user_id_fkey,
  ADD CONSTRAINT academic_schedules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 2. schedule_files.user_id → public.users(id): RESTRICT → CASCADE
--    File records belong to the user and should be removed with them.
ALTER TABLE public.schedule_files
  DROP CONSTRAINT schedule_files_user_id_fkey,
  ADD CONSTRAINT schedule_files_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- 3. ai_indexing_exclusions.excluded_by → auth.users(id): RESTRICT → SET NULL
--    Admin exclusion records should survive user deletion. Drop NOT NULL first.
ALTER TABLE public.ai_indexing_exclusions
  ALTER COLUMN excluded_by DROP NOT NULL;

ALTER TABLE public.ai_indexing_exclusions
  DROP CONSTRAINT ai_indexing_exclusions_excluded_by_fkey,
  ADD CONSTRAINT ai_indexing_exclusions_excluded_by_fkey
    FOREIGN KEY (excluded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4. enterprise_audit_logs.actor_user_id → auth.users(id): RESTRICT → SET NULL
--    Audit records must survive user deletion. Drop NOT NULL first.
ALTER TABLE public.enterprise_audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE public.enterprise_audit_logs
  DROP CONSTRAINT enterprise_audit_logs_actor_user_id_fkey,
  ADD CONSTRAINT enterprise_audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5. dev_admin_audit_logs.admin_user_id → auth.users(id): RESTRICT → SET NULL
--    Audit records must survive user deletion. Drop NOT NULL first.
ALTER TABLE public.dev_admin_audit_logs
  ALTER COLUMN admin_user_id DROP NOT NULL;

ALTER TABLE public.dev_admin_audit_logs
  DROP CONSTRAINT dev_admin_audit_logs_admin_user_id_fkey,
  ADD CONSTRAINT dev_admin_audit_logs_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 6. form_submissions.user_id → public.users(id): RESTRICT → SET NULL
--    Already nullable. Submission records persist anonymized after user deletion.
ALTER TABLE public.form_submissions
  DROP CONSTRAINT form_submissions_user_id_fkey,
  ADD CONSTRAINT form_submissions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
