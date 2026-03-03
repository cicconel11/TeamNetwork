-- =============================================================================
-- Migration: User Deletion Cron Support
-- Date: 2026-03-03
-- Purpose: Prepare the database for a cron job that processes user deletion
--          requests. Adds audit trail, expands status enum, fixes FK constraints
--          that would block auth.admin.deleteUser(), and adds RPC functions for
--          atomic batch claiming and data cleanup.
-- =============================================================================

-- =============================================================================
-- Part A: Schema Changes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Section 1: Fix user_deletion_requests table
-- -----------------------------------------------------------------------------

-- Drop the FK constraint on user_deletion_requests.user_id.
-- The user_id column is retained as a UUID audit artifact so cron code can
-- still log which user was deleted even after auth.users row is gone.
-- Without this drop, Postgres would null/cascade the column when the auth
-- user is deleted, causing a "stale recovery requeue null user" edge case.
ALTER TABLE public.user_deletion_requests
  DROP CONSTRAINT IF EXISTS user_deletion_requests_user_id_fkey;

-- Expand the status check constraint to include 'processing' (cron claims the
-- row before starting work) and 'failed' (non-fatal errors that can be retried
-- or inspected).
ALTER TABLE public.user_deletion_requests
  DROP CONSTRAINT IF EXISTS user_deletion_requests_status_check;
ALTER TABLE public.user_deletion_requests
  ADD CONSTRAINT user_deletion_requests_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

-- Store the reason a deletion failed so operators can investigate without
-- trawling application logs.
ALTER TABLE public.user_deletion_requests
  ADD COLUMN IF NOT EXISTS failed_reason TEXT;

-- Index used by the stale-recovery query: finds rows stuck in 'processing'
-- (e.g. cron pod crashed mid-run) ordered by when they last changed state.
CREATE INDEX IF NOT EXISTS idx_user_deletion_requests_processing
  ON public.user_deletion_requests(status, updated_at)
  WHERE status = 'processing';

-- -----------------------------------------------------------------------------
-- Section 2: Create user_deletion_audit table
-- -----------------------------------------------------------------------------

-- Permanent audit trail written AFTER the auth.users row is deleted, so we
-- intentionally omit the FK to auth.users. The user_id here is an opaque UUID
-- kept for compliance/forensics only.
CREATE TABLE IF NOT EXISTS public.user_deletion_audit (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL,  -- no FK; auth user already deleted
  user_email              TEXT,                  -- captured before deletion
  deleted_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  tables_affected         INT,
  storage_objects_deleted INT
);

-- No RLS needed: only service_role writes to this table from cron routes.
-- Authenticated users have no business reading deletion audit records.

CREATE INDEX IF NOT EXISTS idx_user_deletion_audit_user_id
  ON public.user_deletion_audit(user_id);

CREATE INDEX IF NOT EXISTS idx_user_deletion_audit_deleted_at
  ON public.user_deletion_audit(deleted_at);

-- -----------------------------------------------------------------------------
-- Section 3: Normalize FK behavior on non-cascading auth.users references
--
-- These tables have FK columns that reference auth.users(id) with either no
-- ON DELETE action (defaults to RESTRICT) or NOT NULL, which would cause
-- auth.admin.deleteUser() to fail with a foreign-key violation.
--
-- Strategy A: SET NULL — preserve the row for audit/historical purposes,
--             null the actor/author column.
-- Strategy B: CASCADE — delete the row when the user is deleted (appropriate
--             for rows that exist only because of the user).
-- -----------------------------------------------------------------------------

-- Strategy A: SET NULL (preserve row, null the actor reference)

-- enterprise_audit_logs.actor_user_id
-- Audit log rows must survive user deletion for compliance. The actor's
-- identity is already captured in actor_email_redacted, so nulling actor_user_id
-- is safe.
ALTER TABLE public.enterprise_audit_logs
  DROP CONSTRAINT IF EXISTS enterprise_audit_logs_actor_user_id_fkey;
ALTER TABLE public.enterprise_audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.enterprise_audit_logs
  ADD CONSTRAINT enterprise_audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- dev_admin_audit_logs.admin_user_id
-- Same rationale as enterprise_audit_logs: admin_email_redacted preserves
-- identity context; the row must not be deleted when the admin account is.
ALTER TABLE public.dev_admin_audit_logs
  DROP CONSTRAINT IF EXISTS dev_admin_audit_logs_admin_user_id_fkey;
ALTER TABLE public.dev_admin_audit_logs
  ALTER COLUMN admin_user_id DROP NOT NULL;
ALTER TABLE public.dev_admin_audit_logs
  ADD CONSTRAINT dev_admin_audit_logs_admin_user_id_fkey
    FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- enterprise_adoption_requests.requested_by
-- Adoption requests are business records that should survive requester deletion.
-- The request's status/history remains meaningful even without the requestor.
ALTER TABLE public.enterprise_adoption_requests
  DROP CONSTRAINT IF EXISTS enterprise_adoption_requests_requested_by_fkey;
ALTER TABLE public.enterprise_adoption_requests
  ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE public.enterprise_adoption_requests
  ADD CONSTRAINT enterprise_adoption_requests_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- enterprise_adoption_requests.responded_by
-- Already nullable; just ensure ON DELETE SET NULL is set so a responder
-- deletion doesn't block the requestor's deletion or vice versa.
ALTER TABLE public.enterprise_adoption_requests
  DROP CONSTRAINT IF EXISTS enterprise_adoption_requests_responded_by_fkey;
ALTER TABLE public.enterprise_adoption_requests
  ADD CONSTRAINT enterprise_adoption_requests_responded_by_fkey
    FOREIGN KEY (responded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- workouts.created_by
-- Workout records belong to the organization, not the creator. Preserve them.
ALTER TABLE public.workouts
  DROP CONSTRAINT IF EXISTS workouts_created_by_fkey;
ALTER TABLE public.workouts
  ADD CONSTRAINT workouts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- competition_points.created_by
-- Competition points are organizational data. Preserve them when creator is
-- deleted.
ALTER TABLE public.competition_points
  DROP CONSTRAINT IF EXISTS competition_points_created_by_fkey;
ALTER TABLE public.competition_points
  ADD CONSTRAINT competition_points_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Strategy B: CASCADE (delete the row when the user is deleted)

-- enterprise_invites.created_by_user_id
-- Invites are tied to the creating admin's authority. Once the admin is gone,
-- outstanding invites they created should be cleaned up to prevent orphaned
-- access grants.
ALTER TABLE public.enterprise_invites
  DROP CONSTRAINT IF EXISTS enterprise_invites_created_by_user_id_fkey;
ALTER TABLE public.enterprise_invites
  ADD CONSTRAINT enterprise_invites_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- parent_invites.invited_by
-- Similar to enterprise_invites: the invite was issued under a specific admin's
-- authority and should not remain redeemable after they are deleted.
ALTER TABLE public.parent_invites
  DROP CONSTRAINT IF EXISTS parent_invites_invited_by_fkey;
ALTER TABLE public.parent_invites
  ADD CONSTRAINT parent_invites_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;

-- academic_schedules.user_id
-- These rows exist solely for the owning user. No organizational value without
-- the user.
ALTER TABLE public.academic_schedules
  DROP CONSTRAINT IF EXISTS academic_schedules_user_id_fkey;
ALTER TABLE public.academic_schedules
  ADD CONSTRAINT academic_schedules_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- schedule_files.user_id
-- User-uploaded files; delete the metadata row when the user is deleted.
-- (The cron job collects file paths before deletion for storage cleanup.)
ALTER TABLE public.schedule_files
  DROP CONSTRAINT IF EXISTS schedule_files_user_id_fkey;
ALTER TABLE public.schedule_files
  ADD CONSTRAINT schedule_files_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- payment_attempts.user_id
-- Already nullable (anonymous donations exist). Add CASCADE so Stripe
-- audit rows tied to a user are removed when the user is deleted.
-- Note: Stripe's own records are not affected; this is our internal log only.
ALTER TABLE public.payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_user_id_fkey;
ALTER TABLE public.payment_attempts
  ADD CONSTRAINT payment_attempts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- Section 4: Make author_id nullable on shared-content tables
--
-- These columns currently carry NOT NULL + ON DELETE CASCADE, meaning a user
-- deletion would hard-delete posts, messages, and comments — destroying shared
-- community history. We change to nullable + ON DELETE SET NULL so content is
-- preserved with the author anonymized (displayed as "Deleted user").
-- -----------------------------------------------------------------------------

-- chat_messages.author_id
ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_author_id_fkey;
ALTER TABLE public.chat_messages
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- discussion_threads.author_id
ALTER TABLE public.discussion_threads
  DROP CONSTRAINT IF EXISTS discussion_threads_author_id_fkey;
ALTER TABLE public.discussion_threads
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.discussion_threads
  ADD CONSTRAINT discussion_threads_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- discussion_replies.author_id
ALTER TABLE public.discussion_replies
  DROP CONSTRAINT IF EXISTS discussion_replies_author_id_fkey;
ALTER TABLE public.discussion_replies
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.discussion_replies
  ADD CONSTRAINT discussion_replies_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- feed_posts.author_id
ALTER TABLE public.feed_posts
  DROP CONSTRAINT IF EXISTS feed_posts_author_id_fkey;
ALTER TABLE public.feed_posts
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.feed_posts
  ADD CONSTRAINT feed_posts_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- feed_comments.author_id
ALTER TABLE public.feed_comments
  DROP CONSTRAINT IF EXISTS feed_comments_author_id_fkey;
ALTER TABLE public.feed_comments
  ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE public.feed_comments
  ADD CONSTRAINT feed_comments_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- =============================================================================
-- Part B: Supabase RPC Functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Function 1: delete_user_data(p_user_id UUID)
--
-- Handles all user data cleanup in a single transaction. Called by the cron
-- route before calling auth.admin.deleteUser(). Returns a summary row so the
-- caller can write an audit record without re-querying the now-deleted data.
--
-- Returns: (tables_affected INT, storage_paths TEXT[])
--   tables_affected   — count of tables that had at least one row affected
--   storage_paths     — file paths to delete from storage buckets after the
--                       transaction commits (collected before rows are deleted)
--
-- Security: SECURITY DEFINER so service_role can run it without needing
-- individual grants on every table. Explicitly REVOKE from PUBLIC and only
-- GRANT to service_role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id UUID)
RETURNS TABLE(tables_affected INT, storage_paths TEXT[]) AS $$
DECLARE
  v_tables INT := 0;
  v_paths  TEXT[] := '{}';
  v_count  INT;
BEGIN
  -- Collect storage file paths BEFORE deleting rows so we don't lose the
  -- references. These are returned to the caller for out-of-band storage
  -- bucket cleanup (Supabase Storage API calls happen outside this transaction).
  SELECT ARRAY_AGG(file_path) INTO v_paths
  FROM (
    SELECT file_path  FROM public.schedule_files          WHERE user_id = p_user_id
    UNION ALL
    SELECT file_path  FROM public.form_document_submissions WHERE user_id = p_user_id
  ) paths;

  IF v_paths IS NULL THEN
    v_paths := '{}';
  END IF;

  -- Hard-delete user-owned rows
  -- (Each block increments v_tables only when rows were actually affected,
  --  so the caller gets an accurate "tables touched" count for auditing.)

  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.user_calendar_connections WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.mentorship_pairs
    WHERE mentor_user_id = p_user_id OR mentee_user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.mentor_profiles WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.form_submissions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.form_document_submissions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.event_rsvps WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  -- schedule_files and academic_schedules now have ON DELETE CASCADE from
  -- Section 3, but we still delete them explicitly here so the cron function
  -- runs cleanly even before auth.admin.deleteUser() is called.
  DELETE FROM public.schedule_files WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.academic_schedules WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.parents WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.analytics_consent WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  -- Anonymize shared content: preserve rows but null the author reference.
  -- After Section 4 above these columns are nullable, so the UPDATE succeeds.
  -- Content is displayed to other users as "Deleted user" at the app layer.

  UPDATE public.discussion_threads SET author_id = NULL WHERE author_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  UPDATE public.discussion_replies SET author_id = NULL WHERE author_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  UPDATE public.feed_posts SET author_id = NULL WHERE author_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  UPDATE public.feed_comments SET author_id = NULL WHERE author_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  UPDATE public.chat_messages SET author_id = NULL WHERE author_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  -- Delete organization memberships last so any RLS-bypassing queries
  -- above can still resolve org context if needed.
  DELETE FROM public.members WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.user_organization_roles WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  DELETE FROM public.alumni WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_tables := v_tables + CASE WHEN v_count > 0 THEN 1 ELSE 0 END;

  RETURN QUERY SELECT v_tables, v_paths;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Restrict to service_role only; no direct user access.
REVOKE ALL ON FUNCTION public.delete_user_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_data(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- Function 2: claim_pending_deletions(p_limit INT)
--
-- Atomically claims up to p_limit pending deletion requests that are past their
-- scheduled_deletion_at time, transitions them to 'processing', and returns
-- the claimed rows.
--
-- Uses FOR UPDATE SKIP LOCKED to prevent double-processing when multiple cron
-- workers run concurrently (e.g. on separate Vercel instances or during a
-- retry). Only rows with status = 'pending' AND scheduled_deletion_at <= now()
-- are eligible.
--
-- Returns: TABLE(req_id UUID, req_user_id UUID)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_deletions(p_limit INT DEFAULT 10)
RETURNS TABLE(req_id UUID, req_user_id UUID) AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT dr.id, dr.user_id
    FROM public.user_deletion_requests dr
    WHERE dr.status = 'pending'
      AND dr.scheduled_deletion_at <= now()
    ORDER BY dr.scheduled_deletion_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED  -- skip rows locked by concurrent cron workers
  )
  UPDATE public.user_deletion_requests
     SET status     = 'processing',
         updated_at = now()
    FROM candidates
   WHERE public.user_deletion_requests.id = candidates.id
  RETURNING public.user_deletion_requests.id,
            public.user_deletion_requests.user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Restrict to service_role only.
REVOKE ALL ON FUNCTION public.claim_pending_deletions(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_deletions(INT) TO service_role;
