-- AI thread list pagination sorts by updated_at DESC, id DESC; existing
-- idx_ai_threads_org_listing keys on created_at, so the planner falls back to
-- scan + sort. Add a partial index that matches the actual order key.
--
-- Plain CREATE INDEX (not CONCURRENTLY): Supabase migrations run inside a
-- transaction and CONCURRENTLY cannot. ai_threads is small, write volume on
-- the listing path is low, so the brief SHARE lock is acceptable.
--
-- The older idx_ai_threads_org_listing (created_at) stays in place until a
-- follow-up migration drops it after pg_stat_user_indexes.idx_scan = 0 has
-- been observed for one week.

CREATE INDEX IF NOT EXISTS idx_ai_threads_org_updated
  ON public.ai_threads (org_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
