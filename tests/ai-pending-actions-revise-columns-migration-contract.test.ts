import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260423000000_ai_pending_actions_revise_columns.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_pending_actions revise columns migration contract", () => {
  it("adds previous_payload jsonb column as nullable", () => {
    assert.match(migration, /ALTER TABLE ai_pending_actions/i);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS previous_payload jsonb/i);
    // No NOT NULL on previous_payload — edits populate it, new drafts leave it null.
    assert.doesNotMatch(migration, /previous_payload\s+jsonb\s+NOT NULL/i);
  });

  it("adds revise_count integer column with default 0, NOT NULL", () => {
    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS revise_count integer\s+NOT NULL\s+DEFAULT\s+0/i
    );
  });
});
