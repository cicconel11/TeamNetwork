import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260719000000_ai_audit_stage_timings.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_audit_log stage timings migration contract", () => {
  it("adds stage_timings column to ai_audit_log", () => {
    assert.match(migration, /ALTER TABLE ai_audit_log/i);
    assert.match(migration, /ADD COLUMN stage_timings\s+jsonb/i);
  });
});
