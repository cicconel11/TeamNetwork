import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261101000005_ai_draft_sessions_widen_unique_key.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_draft_sessions widen unique-key migration contract", () => {
  it("drops the narrow (thread_id) unique index", () => {
    assert.match(
      migration,
      /DROP\s+INDEX\s+IF\s+EXISTS\s+idx_ai_draft_sessions_thread\b/i
    );
  });

  it("creates the new (thread_id, draft_type) unique index", () => {
    assert.match(
      migration,
      /CREATE\s+UNIQUE\s+INDEX\s+idx_ai_draft_sessions_thread_type\b/i
    );
    assert.match(migration, /ON\s+public\.ai_draft_sessions\s*\(\s*thread_id\s*,\s*draft_type\s*\)/i);
  });

  it("drops before it creates — order matters for an index swap", () => {
    const dropMatch = migration.match(/DROP\s+INDEX\s+IF\s+EXISTS\s+idx_ai_draft_sessions_thread\b/i);
    const createMatch = migration.match(/CREATE\s+UNIQUE\s+INDEX\s+idx_ai_draft_sessions_thread_type\b/i);
    assert.ok(dropMatch, "DROP must be present");
    assert.ok(createMatch, "CREATE must be present");
    assert.ok(
      dropMatch!.index! < createMatch!.index!,
      "DROP of the old index must appear before CREATE of the new one"
    );
  });

  it("does not use CREATE INDEX CONCURRENTLY (Supabase migrations are transactional)", () => {
    // Scoped to the actual DDL statement rather than any text in a SQL
    // comment that happens to contain the word "CONCURRENTLY".
    assert.doesNotMatch(migration, /CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY/i);
  });
});
