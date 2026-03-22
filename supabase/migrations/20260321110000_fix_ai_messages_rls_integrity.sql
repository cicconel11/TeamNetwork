-- Fix: restore thread-ownership invariant on ai_messages RLS + add composite FK
--
-- The previous migration (20260321100000) replaced subquery-based RLS policies
-- with direct user_id = auth.uid() checks. This removed two guarantees:
--   1. Messages could only be inserted/read for threads owned by the user
--   2. Messages in soft-deleted threads were excluded
--
-- This migration restores both guarantees:
--   - Composite FK (thread_id, user_id, org_id) prevents drift at the DB level
--   - RLS policies use fast user_id check + EXISTS for deleted_at filtering

-- ============================================================
-- Step 1: Add UNIQUE constraint on ai_threads for composite FK target
-- (id is already PK/unique, but composite FK requires a matching unique index)
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_threads_composite_key
  ON public.ai_threads (id, user_id, org_id);

-- ============================================================
-- Step 2: Replace simple thread_id FK with composite FK
-- Preserves ON DELETE CASCADE behavior from the original
-- ============================================================

ALTER TABLE public.ai_messages
  DROP CONSTRAINT IF EXISTS ai_messages_thread_id_fkey;

ALTER TABLE public.ai_messages
  ADD CONSTRAINT ai_messages_thread_owner_fkey
    FOREIGN KEY (thread_id, user_id, org_id)
    REFERENCES public.ai_threads (id, user_id, org_id)
    ON DELETE CASCADE;

-- ============================================================
-- Step 3: Replace weak RLS policies with thread-aware policies
-- Direct user_id check short-circuits cheaply; EXISTS only fires
-- for the deleted_at check (ownership is now enforced by the FK)
-- ============================================================

DROP POLICY IF EXISTS "Users can select own messages" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_messages;

-- SELECT: user owns the message AND thread is not soft-deleted
CREATE POLICY "Users can select own messages"
  ON public.ai_messages FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );

-- INSERT: user owns the message AND target thread is not soft-deleted
-- (composite FK separately enforces thread_id/user_id/org_id consistency)
CREATE POLICY "Users can insert own messages"
  ON public.ai_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );

-- UPDATE: same checks on both USING (row visibility) and WITH CHECK (new values)
CREATE POLICY "Users can update own messages"
  ON public.ai_messages FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_threads
      WHERE ai_threads.id = ai_messages.thread_id
        AND ai_threads.deleted_at IS NULL
    )
  );
