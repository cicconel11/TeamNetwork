import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260319000000_ai_assistant_tables.sql", import.meta.url),
  "utf8"
);

describe("AI migration contract", () => {
  it("requires non-deleted parent threads for ai_messages INSERT policy", () => {
    assert.match(
      migration,
      /CREATE POLICY "Users can insert messages in own threads"[\s\S]*deleted_at IS NULL/
    );
  });

  it("requires non-deleted parent threads for ai_messages UPDATE policy", () => {
    assert.match(
      migration,
      /CREATE POLICY "Users can update messages in own threads"[\s\S]*deleted_at IS NULL[\s\S]*deleted_at IS NULL/
    );
  });
});
