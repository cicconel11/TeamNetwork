-- Architecture fixes: soft-delete adoption, ai_messages denormalization, FK constraints
-- Issues: A1 (soft-delete), A2 (ai_messages org_id/user_id), A4 (schedule_allowed_domains FKs)

-- ============================================================
-- A1: Soft-delete adoption — add deleted_at to 6 tables
-- ============================================================

-- form_submissions
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_form_submissions_not_deleted
  ON public.form_submissions (organization_id)
  WHERE deleted_at IS NULL;

-- form_document_submissions
ALTER TABLE public.form_document_submissions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_form_document_submissions_not_deleted
  ON public.form_document_submissions (document_id)
  WHERE deleted_at IS NULL;

-- competition_teams
ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_competition_teams_not_deleted
  ON public.competition_teams (organization_id)
  WHERE deleted_at IS NULL;

-- organization_donations (compliance-critical — insert-only in app, deleted_at is a guard)
ALTER TABLE public.organization_donations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_organization_donations_not_deleted
  ON public.organization_donations (organization_id)
  WHERE deleted_at IS NULL;

-- mentorship_pairs
ALTER TABLE public.mentorship_pairs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mentorship_pairs_not_deleted
  ON public.mentorship_pairs (organization_id)
  WHERE deleted_at IS NULL;

-- mentorship_logs
ALTER TABLE public.mentorship_logs
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mentorship_logs_not_deleted
  ON public.mentorship_logs (pair_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- A2: Add org_id / user_id to ai_messages (denormalization)
-- Three-step: add nullable → backfill → set NOT NULL
-- ============================================================

-- Step 1: Add columns as nullable
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Step 2: Backfill from parent thread
UPDATE public.ai_messages m
SET
  org_id  = t.org_id,
  user_id = t.user_id
FROM public.ai_threads t
WHERE m.thread_id = t.id
  AND (m.org_id IS NULL OR m.user_id IS NULL);

-- Step 3: Enforce NOT NULL after backfill
ALTER TABLE public.ai_messages
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Indexes for direct org/user lookups
CREATE INDEX IF NOT EXISTS idx_ai_messages_org_id
  ON public.ai_messages (org_id);

CREATE INDEX IF NOT EXISTS idx_ai_messages_user_id
  ON public.ai_messages (user_id);

-- Step 5: Replace subquery-based RLS policies with direct column checks
DROP POLICY IF EXISTS "Users can select messages in own threads" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can insert messages in own threads" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can update messages in own threads" ON public.ai_messages;

CREATE POLICY "Users can select own messages"
  ON public.ai_messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own messages"
  ON public.ai_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own messages"
  ON public.ai_messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- A4: FK constraints on schedule_allowed_domains audit columns
-- Both use ON DELETE SET NULL — domain record survives user/org deletion
-- ============================================================

ALTER TABLE public.schedule_allowed_domains
  ADD CONSTRAINT fk_schedule_allowed_domains_verified_by_user
    FOREIGN KEY (verified_by_user_id)
    REFERENCES auth.users(id)
    ON DELETE SET NULL;

ALTER TABLE public.schedule_allowed_domains
  ADD CONSTRAINT fk_schedule_allowed_domains_verified_by_org
    FOREIGN KEY (verified_by_org_id)
    REFERENCES public.organizations(id)
    ON DELETE SET NULL;
