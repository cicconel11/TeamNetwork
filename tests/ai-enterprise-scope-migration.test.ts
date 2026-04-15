import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261015000000_ai_enterprise_scope.sql", import.meta.url),
  "utf8"
);

describe("AI enterprise scope migration contract", () => {
  it("scopes ai_messages idempotency uniqueness across org and enterprise rows", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX idx_ai_messages_idempotency_scoped[\s\S]*CASE WHEN enterprise_id IS NULL THEN 'org' ELSE 'enterprise' END[\s\S]*COALESCE\(org_id, enterprise_id\)[\s\S]*user_id[\s\S]*idempotency_key/
    );
  });

  it("cascades enterprise-scoped audit rows on enterprise deletion", () => {
    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS enterprise_id uuid[\s\S]*REFERENCES public\.enterprises\(id\) ON DELETE CASCADE;/
    );
  });

  it("keeps enterprise thread and message updates fail-closed on role changes", () => {
    assert.match(
      migration,
      /CREATE POLICY "Users can update own enterprise threads"[\s\S]*WITH CHECK \([\s\S]*uer\.enterprise_id = ai_threads\.enterprise_id[\s\S]*uer\.role IN \('owner', 'billing_admin', 'org_admin'\)/
    );
    assert.match(
      migration,
      /CREATE POLICY "Users can update own enterprise messages"[\s\S]*WITH CHECK \([\s\S]*uer\.enterprise_id = ai_messages\.enterprise_id[\s\S]*uer\.role IN \('owner', 'billing_admin', 'org_admin'\)/
    );
  });
});
