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

const mutationDraftsMigration = readFileSync(
  new URL(
    "../supabase/migrations/20261205000000_ai_draft_sessions_add_mutation_drafts.sql",
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

  it("extends the draft_type check constraint for update/delete draft continuations", () => {
    assert.match(mutationDraftsMigration, /ALTER TABLE public\.ai_draft_sessions/i);
    assert.match(mutationDraftsMigration, /DROP CONSTRAINT IF EXISTS ai_draft_sessions_draft_type_check/i);
    for (const draftType of [
      "create_announcement",
      "update_announcement",
      "delete_announcement",
      "create_job_posting",
      "update_job_posting",
      "delete_job_posting",
      "send_chat_message",
      "send_group_chat_message",
      "create_discussion_reply",
      "create_discussion_thread",
      "create_event",
      "update_event",
      "delete_event",
    ]) {
      assert.match(mutationDraftsMigration, new RegExp(`'${draftType}'`));
    }
  });
});
