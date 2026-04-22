import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261101000001_ai_pending_actions_tier1_mutation_columns_and_indexes.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_pending_actions Tier 1 migration — added columns", () => {
  it("adds target_entity_type text", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS target_entity_type text/);
  });

  it("adds target_entity_id uuid", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS target_entity_id uuid/);
  });

  it("adds payload_before jsonb", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS payload_before jsonb/);
  });

  it("adds resolved_target jsonb", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS resolved_target jsonb/);
  });

  it("adds attempt_count int NOT NULL DEFAULT 0", () => {
    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS attempt_count\s+int\s+NOT NULL\s+DEFAULT\s+0/i
    );
  });

  it("adds last_attempt_error text", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS last_attempt_error text/);
  });

  it("adds replay_result jsonb", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS replay_result jsonb/);
  });
});

describe("ai_pending_actions Tier 1 migration — most-recent-entity index", () => {
  it("creates the user_entity_executed partial composite index", () => {
    assert.match(
      migration,
      /CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_user_entity_executed/i
    );
  });

  it("indexes (user_id, organization_id, result_entity_type, executed_at DESC, id)", () => {
    assert.match(
      migration,
      /ON public\.ai_pending_actions\s*\(\s*user_id\s*,\s*organization_id\s*,\s*result_entity_type\s*,\s*executed_at\s+DESC\s*,\s*id\s*\)/i
    );
  });

  it("uses INCLUDE (result_entity_id) for index-only scan", () => {
    assert.match(migration, /INCLUDE\s*\(\s*result_entity_id\s*\)/i);
  });

  it("restricts to executed rows with a result_entity_id", () => {
    assert.match(
      migration,
      /WHERE\s+status\s*=\s*'executed'\s+AND\s+result_entity_id\s+IS\s+NOT\s+NULL/i
    );
  });
});

describe("ai_pending_actions Tier 1 migration — one-pending-per-target unique index", () => {
  it("creates idx_ai_pending_actions_one_pending_per_target as UNIQUE", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_pending_actions_one_pending_per_target/i
    );
  });

  it("keys on (organization_id, target_entity_type, target_entity_id)", () => {
    assert.match(
      migration,
      /\(\s*organization_id\s*,\s*target_entity_type\s*,\s*target_entity_id\s*\)/i
    );
  });

  it("applies only to pending rows with a target_entity_id", () => {
    assert.match(
      migration,
      /WHERE\s+status\s*=\s*'pending'\s+AND\s+target_entity_id\s+IS\s+NOT\s+NULL/i
    );
  });
});

describe("ai_pending_actions Tier 1 migration — repo conventions", () => {
  it("follows the repo's plain CREATE INDEX convention (no CONCURRENTLY)", () => {
    // Supabase wraps each migration in a transaction; CONCURRENTLY would fail.
    // See 20260812000003_perf_hotpath_indexes_and_initplan.sql for the stated convention.
    assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
  });
});
