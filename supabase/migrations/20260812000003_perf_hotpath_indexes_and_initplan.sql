-- Migration: Hot-path indexes, RLS initplan fixes, and redundant index cleanup
-- Three sections:
--   1. Wrap bare auth.role() in 4 service-role RLS policies with (select auth.role())
--   2. Create 5 composite indexes for hot query paths
--   3. Drop 2 redundant indexes on events table

-- ============================================================
-- Part 1: RLS initplan fixes — auth.role() → (select auth.role())
-- Converts volatile per-row evaluation into an initplan evaluated once per query.
-- ============================================================

ALTER POLICY "oauth_state_service_role" ON public.org_integration_oauth_state
  USING ((select auth.role()) = 'service_role');

ALTER POLICY "org_integrations_service_role" ON public.org_integrations
  USING ((select auth.role()) = 'service_role');

ALTER POLICY "alumni_external_ids_service_role" ON public.alumni_external_ids
  USING ((select auth.role()) = 'service_role');

ALTER POLICY "integration_sync_log_service_role" ON public.integration_sync_log
  USING ((select auth.role()) = 'service_role');

-- ============================================================
-- Part 2: Create 5 hot-path composite indexes
-- Uses plain CREATE INDEX (not CONCURRENTLY) — Supabase migrations run in a transaction.
-- ============================================================

-- Thread replies listing — discussion_replies has ZERO indexes
CREATE INDEX IF NOT EXISTS idx_discussion_replies_hot
  ON public.discussion_replies (thread_id, deleted_at, created_at ASC);

-- Discussions list page — dropped in PR #48, restored for real query pattern
CREATE INDEX IF NOT EXISTS idx_discussion_threads_hot
  ON public.discussion_threads (organization_id, deleted_at, is_pinned DESC, last_activity_at DESC);

-- AI thread list pagination (threads/handler.ts)
CREATE INDEX IF NOT EXISTS idx_ai_threads_org_listing
  ON public.ai_threads (org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- AI message history fetch on every chat turn (chat/handler.ts:642)
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread_status
  ON public.ai_messages (thread_id, status, created_at ASC);

-- Admin count check before member removal
CREATE INDEX IF NOT EXISTS idx_chat_group_members_role
  ON public.chat_group_members (chat_group_id, role, removed_at);

-- ============================================================
-- Part 3: Drop 2 redundant indexes on events
-- ============================================================

-- Partial index on (recurrence_group_id) WHERE recurrence_index = 0
-- No DB query filters recurrence_index = 0; parent identification is done in JS.
-- idx_events_recurrence_group covers all actual queries.
DROP INDEX IF EXISTS idx_events_recurrence_parent;

-- KEPT: events_org_id_idx
-- The original comment claimed "all real queries filter soft-deletes" — that is false.
-- Counterexamples that scan events without `deleted_at IS NULL`:
--   src/app/api/stripe/create-donation/route.ts:144  (point lookup id + organization_id)
--   src/app/[orgSlug]/philanthropy/page.tsx:32       (philanthropy event listing)
-- Both should also be fixed at the application layer to filter soft-deletes,
-- but until they are, this index prevents seq scans on the events table on
-- every donation creation and philanthropy page load. See follow-up issue.
