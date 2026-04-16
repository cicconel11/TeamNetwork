import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260813000001_ai_draft_sessions_add_chat_message.sql",
    import.meta.url
  ),
  "utf8"
);

describe("ai_draft_sessions chat message migration contract", () => {
  it("extends the draft_type check constraint for chat-message drafts", () => {
    assert.match(migration, /ALTER TABLE ai_draft_sessions/i);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check/i);
    assert.match(migration, /create_announcement/);
    assert.match(migration, /send_chat_message/);
    assert.match(migration, /create_discussion_reply/);
    assert.match(migration, /create_discussion_thread/);
    assert.match(migration, /create_event/);
    assert.match(migration, /create_job_posting/);
  });
});
