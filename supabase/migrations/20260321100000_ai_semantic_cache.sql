-- AI Semantic Cache
-- Plan 2: Semantic response cache — deduplicates identical AI responses by prompt hash
--
-- RLS NOTE: Both ai_semantic_cache and ai_audit_log use service-role-only
-- access (createServiceClient). RLS is enabled with no policies — the
-- service_role key bypasses RLS by design. If user-scoped access is ever
-- needed, add RLS policies at that time.

-- Vector extension required for future embedding-based similarity search
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

-- Semantic cache: stores AI responses keyed by org, surface, permission scope, and prompt hash
CREATE TABLE ai_semantic_cache (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  surface               text NOT NULL
                        CHECK (surface IN ('general', 'members', 'analytics', 'events')),
  permission_scope_key  text NOT NULL,
  cache_version         integer NOT NULL,
  prompt_normalized     text NOT NULL,
  prompt_hash           text NOT NULL,
  response_content      text NOT NULL
                        CHECK (char_length(response_content) <= 16000),
  source_message_id     uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  invalidated_at        timestamptz,
  invalidation_reason   text
                        CHECK (char_length(invalidation_reason) <= 500)
);

-- Exact lookup with deduplication (prevents concurrent duplicate writes)
CREATE UNIQUE INDEX idx_ai_semantic_cache_unique_key
  ON ai_semantic_cache(org_id, surface, permission_scope_key, cache_version, prompt_hash)
  WHERE invalidated_at IS NULL;

-- TTL filtering
CREATE INDEX idx_ai_semantic_cache_expiry
  ON ai_semantic_cache(expires_at)
  WHERE invalidated_at IS NULL;

CREATE INDEX idx_ai_semantic_cache_invalidated_at
  ON ai_semantic_cache(invalidated_at)
  WHERE invalidated_at IS NOT NULL;

-- ═══════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════

-- Cache table: service-role only (service_role bypasses RLS entirely).
-- No policies = authenticated/anon users cannot SELECT, INSERT, UPDATE, or DELETE.
-- Service client uses service_role key which bypasses RLS, so no policy needed.
ALTER TABLE ai_semantic_cache ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════
-- Purge Function
-- ═══════════════════════════════════════════

-- Removes entries expired for more than 1 day, or invalidated for more than 1 day
CREATE OR REPLACE FUNCTION public.purge_expired_ai_semantic_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.ai_semantic_cache
    WHERE expires_at < now() - interval '1 day'
       OR (invalidated_at IS NOT NULL AND invalidated_at < now() - interval '1 day')
    ORDER BY COALESCE(invalidated_at, expires_at)
    LIMIT 500
  )
  DELETE FROM public.ai_semantic_cache
  WHERE id IN (SELECT id FROM doomed);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_ai_semantic_cache() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_ai_semantic_cache() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_ai_semantic_cache() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_ai_semantic_cache() TO service_role;

-- ═══════════════════════════════════════════
-- Audit Log: cache observability columns
-- ═══════════════════════════════════════════

-- Extend ai_audit_log with cache hit/miss/bypass metadata
ALTER TABLE ai_audit_log
  ADD COLUMN cache_status        text,
  ADD COLUMN cache_entry_id      uuid,
  ADD COLUMN cache_bypass_reason text;
