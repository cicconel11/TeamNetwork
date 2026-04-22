-- Widen the ai_draft_sessions unique key from (thread_id) to
-- (thread_id, draft_type) so a single AI chat thread can hold concurrent
-- drafts of different types — e.g. a `create_announcement` draft and a
-- future `edit_announcement` draft at the same time. This is the last
-- scaffolding piece required before Phase 2+ can register edit/delete
-- `prepare_*` tool families whose drafts coexist with create drafts on
-- the same thread.
--
-- Repo convention is plain DROP/CREATE rather than CREATE INDEX
-- CONCURRENTLY because Supabase runs migrations inside a transaction
-- (see the note in 20260812000001_drop_unused_indexes.sql). No data
-- cleanup is needed: strictly relaxing uniqueness cannot violate the
-- new wider constraint, since every existing row already satisfies the
-- narrower `(thread_id)` rule.

DROP INDEX IF EXISTS idx_ai_draft_sessions_thread;

CREATE UNIQUE INDEX idx_ai_draft_sessions_thread_type
  ON public.ai_draft_sessions (thread_id, draft_type);
