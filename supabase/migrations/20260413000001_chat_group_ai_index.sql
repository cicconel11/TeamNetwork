-- =====================================================
-- Migration: Chat Group AI Index
-- =====================================================
-- Adds performance index for AI assistant group chat queries.
-- Enables fast "which groups is user X in?" lookups.

CREATE INDEX IF NOT EXISTS chat_group_members_user_org_active_idx
  ON public.chat_group_members (user_id, organization_id)
  WHERE removed_at IS NULL;
