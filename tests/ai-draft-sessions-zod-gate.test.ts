import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_SESSION_TYPES,
  saveDraftSession,
  type DraftSessionType,
} from "@/lib/ai/draft-sessions";

describe("DRAFT_SESSION_TYPES const tuple", () => {
  it("exports the 7 known draft types in a readonly tuple", () => {
    assert.deepEqual(
      [...DRAFT_SESSION_TYPES].sort(),
      [
        "create_announcement",
        "create_discussion_reply",
        "create_discussion_thread",
        "create_event",
        "create_job_posting",
        "send_chat_message",
        "send_group_chat_message",
      ]
    );
  });
});

describe("saveDraftSession Zod gate on draft_type", () => {
  const failIfCalled = {
    from: () => {
      throw new Error(
        "supabase.from should not be called when draft_type validation fails"
      );
    },
  } as unknown as Parameters<typeof saveDraftSession>[0];

  const baseInput = {
    organizationId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    threadId: "00000000-0000-0000-0000-000000000003",
    status: "collecting_fields" as const,
    draftPayload: {} as never,
    missingFields: [],
  };

  it("rejects an invalid draft_type string before touching supabase", async () => {
    await assert.rejects(
      () =>
        saveDraftSession(failIfCalled, {
          ...baseInput,
          draftType: "not_a_real_type" as unknown as DraftSessionType,
        }),
      /Invalid draft_type/
    );
  });

  it("rejects empty-string draft_type (simulates bad JSON input)", async () => {
    await assert.rejects(
      () =>
        saveDraftSession(failIfCalled, {
          ...baseInput,
          draftType: "" as unknown as DraftSessionType,
        }),
      /Invalid draft_type/
    );
  });

  it("rejects an attempt to insert a legacy-but-removed value", async () => {
    // If the CHECK constraint used to allow some value we no longer support,
    // the Zod gate should still reject it.
    await assert.rejects(
      () =>
        saveDraftSession(failIfCalled, {
          ...baseInput,
          draftType: "retired_legacy_type" as unknown as DraftSessionType,
        }),
      /Invalid draft_type/
    );
  });
});
