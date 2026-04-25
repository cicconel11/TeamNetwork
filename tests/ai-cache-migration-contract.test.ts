import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260321100001_ai_semantic_cache.sql",
    import.meta.url
  ),
  "utf8"
);

const vercelConfig = readFileSync(
  new URL("../vercel.json", import.meta.url),
  "utf8"
);

describe("ai_semantic_cache migration contract", () => {
  it("enables RLS on cache table", () => {
    assert.match(
      migration,
      /ALTER TABLE ai_semantic_cache ENABLE ROW LEVEL SECURITY/i
    );
  });

  it("does not create user-facing policies on cache table (service-role only)", () => {
    assert.doesNotMatch(
      migration,
      /CREATE POLICY[\s\S]*?ai_semantic_cache/i
    );
  });

  it("creates unique index with required columns", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX idx_ai_semantic_cache_unique_key[\s\S]*?ON ai_semantic_cache\(org_id, surface, permission_scope_key, cache_version, prompt_hash\)/i
    );
  });

  it("creates expiry index for TTL filtering", () => {
    assert.match(
      migration,
      /CREATE INDEX idx_ai_semantic_cache_expiry[\s\S]*?ON ai_semantic_cache\(expires_at\)/i
    );
  });

  it("creates invalidated_at index for purge scans", () => {
    assert.match(
      migration,
      /CREATE INDEX idx_ai_semantic_cache_invalidated_at[\s\S]*?ON ai_semantic_cache\(invalidated_at\)/i
    );
  });

  it("creates purge function for expired cache entries", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.purge_expired_ai_semantic_cache\(\)/i
    );
  });

  it("locks purge function search_path to public", () => {
    assert.match(migration, /SET search_path = public/i);
  });

  it("revokes purge execution from public-facing roles and grants service_role", () => {
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.purge_expired_ai_semantic_cache\(\) FROM PUBLIC;/i
    );
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.purge_expired_ai_semantic_cache\(\) FROM anon;/i
    );
    assert.match(
      migration,
      /REVOKE EXECUTE ON FUNCTION public\.purge_expired_ai_semantic_cache\(\) FROM authenticated;/i
    );
    assert.match(
      migration,
      /GRANT EXECUTE ON FUNCTION public\.purge_expired_ai_semantic_cache\(\) TO service_role;/i
    );
  });

  it("bounds purge work to a fixed batch size", () => {
    assert.match(migration, /LIMIT 500/i);
  });

  it("adds cache_status column to ai_audit_log", () => {
    assert.match(migration, /ADD COLUMN cache_status\s+text/i);
  });

  it("adds cache_entry_id column to ai_audit_log", () => {
    assert.match(migration, /ADD COLUMN cache_entry_id\s+uuid/i);
  });

  it("adds cache_bypass_reason column to ai_audit_log", () => {
    assert.match(migration, /ADD COLUMN cache_bypass_reason\s+text/i);
  });

  it("enables vector extension", () => {
    assert.match(
      migration,
      /CREATE EXTENSION IF NOT EXISTS vector/i
    );
  });

  it("enforces response_content length constraint", () => {
    assert.match(
      migration,
      /char_length\(response_content\)\s*<=\s*16000/i
    );
  });

  it("schedules the ai cache purge cron route", () => {
    const parsed = JSON.parse(vercelConfig) as {
      crons?: Array<{ path: string; schedule: string }>;
    };

    const cachePurgeCron = parsed.crons?.find(
      (cron) => cron.path === "/api/cron/ai-cache-purge"
    );

    assert.ok(
      cachePurgeCron,
      "expected vercel.json to schedule /api/cron/ai-cache-purge"
    );
    assert.equal(cachePurgeCron?.schedule, "0 * * * *");
  });
});

// ---------------------------------------------------------------------------
// Hit-rate view — service-role-only aggregation, used by /api/admin/ai/cache-stats
// ---------------------------------------------------------------------------

const hitRateViewMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261024000000_ai_cache_hit_rate_view.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_cache_hit_rate_daily view contract", () => {
  it("uses CREATE OR REPLACE VIEW for idempotent re-run", () => {
    assert.match(
      hitRateViewMigration,
      /CREATE OR REPLACE VIEW public\.ai_cache_hit_rate_daily/i
    );
  });

  it("aggregates over ai_audit_log", () => {
    assert.match(hitRateViewMigration, /FROM public\.ai_audit_log/i);
  });

  it("buckets by day and cache_status", () => {
    assert.match(hitRateViewMigration, /date_trunc\('day', created_at\)/i);
    assert.match(hitRateViewMigration, /cache_status/i);
    assert.match(hitRateViewMigration, /GROUP BY day, cache_status/i);
  });

  it("limits window to 30 days", () => {
    assert.match(hitRateViewMigration, /interval '30 days'/i);
  });

  it("revokes access from public, anon, authenticated", () => {
    assert.match(hitRateViewMigration, /REVOKE ALL ON public\.ai_cache_hit_rate_daily FROM PUBLIC/i);
    assert.match(hitRateViewMigration, /REVOKE ALL ON public\.ai_cache_hit_rate_daily FROM anon/i);
    assert.match(
      hitRateViewMigration,
      /REVOKE ALL ON public\.ai_cache_hit_rate_daily FROM authenticated/i
    );
  });

  it("grants SELECT to service_role only", () => {
    assert.match(
      hitRateViewMigration,
      /GRANT SELECT ON public\.ai_cache_hit_rate_daily TO service_role/i
    );
  });
});
