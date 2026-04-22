/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleEditAnnouncement } from "@/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/dispatchers/announcements";
import type { PendingActionRecord } from "@/lib/ai/pending-actions";

// ─── Fixtures ───────────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const THREAD_ID = "00000000-0000-4000-8000-000000000003";
const ACTION_ID = "00000000-0000-4000-8000-000000000004";
const TARGET_ID = "00000000-0000-4000-8000-000000000005";
const EXPECTED_UPDATED_AT = "2026-04-22T09:00:00.000Z";

function buildAction(
  overrides: Partial<PendingActionRecord<"edit_announcement">> = {}
): PendingActionRecord<"edit_announcement"> {
  return {
    id: ACTION_ID,
    organization_id: ORG_ID,
    user_id: USER_ID,
    thread_id: THREAD_ID,
    action_type: "edit_announcement",
    payload: {
      targetId: TARGET_ID,
      patch: { title: "Fixed typo" },
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      targetTitle: "Original Title",
      orgSlug: "org",
    },
    status: "pending",
    expires_at: "2099-01-01T00:00:00.000Z",
    created_at: "2026-04-22T08:00:00.000Z",
    updated_at: "2026-04-22T08:00:00.000Z",
    executed_at: null,
    result_entity_type: null,
    result_entity_id: null,
    ...overrides,
  } as PendingActionRecord<"edit_announcement">;
}

function buildCtx(options: {
  serviceSupabase?: any;
  canUseDraftSessions?: boolean;
  onStatusUpdate?: (payload: any) => Promise<{ updated: boolean }>;
  onDraftClear?: (input: any) => Promise<void>;
} = {}) {
  const insertedMessages: any[] = [];
  const statusUpdates: any[] = [];
  const draftClears: any[] = [];

  const defaultServiceSupabase = {
    from(table: string) {
      if (table === "ai_messages") {
        return {
          insert(payload: Record<string, unknown>) {
            insertedMessages.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return {
    ctx: {
      serviceSupabase: options.serviceSupabase ?? defaultServiceSupabase,
      orgId: ORG_ID,
      userId: USER_ID,
      logContext: { requestId: "test-req", orgId: ORG_ID },
      canUseDraftSessions: options.canUseDraftSessions ?? true,
      updatePendingActionStatusFn: (async (_supabase: any, _id: any, payload: any) => {
        statusUpdates.push(payload);
        if (options.onStatusUpdate) return options.onStatusUpdate(payload);
        return { updated: true };
      }) as any,
      clearDraftSessionFn: (async (_supabase: any, input: any) => {
        draftClears.push(input);
        if (options.onDraftClear) return options.onDraftClear(input);
      }) as any,
    },
    insertedMessages,
    statusUpdates,
    draftClears,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("handleEditAnnouncement — success path", () => {
  let harness: ReturnType<typeof buildCtx>;
  beforeEach(() => {
    harness = buildCtx();
  });

  it("calls the primitive with the full payload shape and returns 200 with the updated announcement", async () => {
    let captured: any = null;
    const updateAnnouncementFn = (async (req: any) => {
      captured = req;
      return {
        ok: true,
        value: {
          id: TARGET_ID,
          title: "Fixed typo",
          body: "original body",
          organization_id: ORG_ID,
          updated_at: "2026-04-22T09:05:00.000Z",
        },
      };
    }) as any;

    const response = await handleEditAnnouncement(
      harness.ctx,
      buildAction(),
      { updateAnnouncementFn }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.announcement.id, TARGET_ID);
    assert.equal(body.actionId, ACTION_ID);

    assert.ok(captured, "primitive must be called");
    assert.equal(captured.orgId, ORG_ID);
    assert.equal(captured.userId, USER_ID);
    assert.equal(captured.targetId, TARGET_ID);
    assert.equal(captured.expectedUpdatedAt, EXPECTED_UPDATED_AT);
    assert.deepEqual(captured.patch, { title: "Fixed typo" });
  });

  it("writes the executed CAS transition with resultEntityType=announcement AFTER the primitive succeeds", async () => {
    const updateAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "x",
        updated_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleEditAnnouncement(harness.ctx, buildAction(), { updateAnnouncementFn });

    assert.equal(harness.statusUpdates.length, 1, "exactly one status update on success");
    assert.equal(harness.statusUpdates[0].status, "executed");
    assert.equal(harness.statusUpdates[0].expectedStatus, "confirmed");
    assert.equal(harness.statusUpdates[0].resultEntityType, "announcement");
    assert.equal(harness.statusUpdates[0].resultEntityId, TARGET_ID);
  });

  it("clears the draft session narrowed by (thread_id, draft_type=edit_announcement, pending_action_id)", async () => {
    const updateAnnouncementFn = (async () => ({
      ok: true,
      value: { id: TARGET_ID, title: "x", updated_at: "2026-04-22T09:05:00.000Z" },
    })) as any;

    await handleEditAnnouncement(harness.ctx, buildAction(), { updateAnnouncementFn });

    assert.equal(harness.draftClears.length, 1);
    assert.equal(harness.draftClears[0].organizationId, ORG_ID);
    assert.equal(harness.draftClears[0].userId, USER_ID);
    assert.equal(harness.draftClears[0].threadId, THREAD_ID);
    assert.equal(harness.draftClears[0].pendingActionId, ACTION_ID);
    assert.equal(harness.draftClears[0].draftType, "edit_announcement");
  });

  it("inserts an ai_messages confirmation row with the updated title", async () => {
    const updateAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "New Updated Title",
        updated_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleEditAnnouncement(harness.ctx, buildAction(), { updateAnnouncementFn });

    assert.equal(harness.insertedMessages.length, 1);
    assert.equal(harness.insertedMessages[0].role, "assistant");
    assert.equal(harness.insertedMessages[0].thread_id, THREAD_ID);
    assert.equal(harness.insertedMessages[0].org_id, ORG_ID);
    assert.equal(harness.insertedMessages[0].status, "complete");
    assert.match(
      harness.insertedMessages[0].content,
      /New Updated Title/,
      "content should mention the updated title"
    );
    assert.match(
      harness.insertedMessages[0].content,
      /\/org\/announcements/,
      "content should include the org-scoped announcements URL"
    );
  });

  it("omits the ai_messages URL when orgSlug is empty", async () => {
    const updateAnnouncementFn = (async () => ({
      ok: true,
      value: { id: TARGET_ID, title: "x", updated_at: "2026-04-22T09:05:00.000Z" },
    })) as any;

    await handleEditAnnouncement(
      harness.ctx,
      buildAction({
        payload: {
          targetId: TARGET_ID,
          patch: { title: "x" },
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          targetTitle: "Original Title",
          orgSlug: "",
        },
      }),
      { updateAnnouncementFn }
    );

    assert.doesNotMatch(
      harness.insertedMessages[0].content,
      /\[.*\]\(/,
      "content should be plain text (no markdown link) without orgSlug"
    );
  });

  it("does not clear the draft session when canUseDraftSessions=false", async () => {
    harness = buildCtx({ canUseDraftSessions: false });
    const updateAnnouncementFn = (async () => ({
      ok: true,
      value: { id: TARGET_ID, title: "x", updated_at: "2026-04-22T09:05:00.000Z" },
    })) as any;

    await handleEditAnnouncement(harness.ctx, buildAction(), { updateAnnouncementFn });

    assert.equal(harness.draftClears.length, 0);
  });
});

describe("handleEditAnnouncement — typed-failure paths (no throw)", () => {
  let harness: ReturnType<typeof buildCtx>;
  beforeEach(() => {
    harness = buildCtx();
  });

  for (const [status, errorKey, expectedStatus] of [
    [403, "forbidden", 403],
    [404, "not_found", 404],
    [409, "stale_version", 409],
    [422, "invariant_violation", 422],
    [500, "update_failed", 500],
  ] as const) {
    it(`rolls back confirmed→pending and returns ${status} with error=${errorKey}`, async () => {
      const updateAnnouncementFn = (async () => ({
        ok: false,
        status,
        error: errorKey,
      })) as any;

      const response = await handleEditAnnouncement(
        harness.ctx,
        buildAction(),
        { updateAnnouncementFn }
      );
      const body = await response.json();

      assert.equal(response.status, expectedStatus);
      assert.equal(body.error, errorKey);

      // Single status update: the rollback to pending.
      assert.equal(harness.statusUpdates.length, 1);
      assert.equal(harness.statusUpdates[0].status, "pending");
      assert.equal(harness.statusUpdates[0].expectedStatus, "confirmed");

      // No message insert when the mutation failed.
      assert.equal(harness.insertedMessages.length, 0);
    });
  }

  it("forwards the details payload on 409 stale_version", async () => {
    const updateAnnouncementFn = (async () => ({
      ok: false,
      status: 409,
      error: "stale_version",
      details: {
        expectedUpdatedAt: "A",
        currentUpdatedAt: "B",
      },
    })) as any;

    const response = await handleEditAnnouncement(
      harness.ctx,
      buildAction(),
      { updateAnnouncementFn }
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(body.details, {
      expectedUpdatedAt: "A",
      currentUpdatedAt: "B",
    });
  });
});

describe("handleEditAnnouncement — thrown-failure path (return-await regression)", () => {
  it("lets the rejection propagate (does not swallow it) so handler.ts outer try/catch can roll back", async () => {
    const harness = buildCtx();
    const updateAnnouncementFn = (async () => {
      throw new Error("Supabase timeout");
    }) as any;

    await assert.rejects(
      handleEditAnnouncement(harness.ctx, buildAction(), { updateAnnouncementFn }),
      { message: "Supabase timeout" }
    );

    // The dispatcher itself does NOT rollback on throw — that's the outer
    // try/catch's job. So no CAS updates at this layer.
    assert.equal(harness.statusUpdates.length, 0);
    assert.equal(harness.insertedMessages.length, 0);
    assert.equal(harness.draftClears.length, 0);
  });
});

describe("handleEditAnnouncement — ai_messages failure is logged, not fatal", () => {
  it("returns 200 with the updated announcement even when ai_messages.insert errors", async () => {
    const insertedMessages: any[] = [];
    const loggedErrors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => loggedErrors.push(args);
    try {
      const serviceSupabase = {
        from(table: string) {
          if (table === "ai_messages") {
            return {
              insert(payload: Record<string, unknown>) {
                insertedMessages.push(payload);
                return Promise.resolve({ error: { message: "insert failed" } });
              },
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
      const harness = buildCtx({ serviceSupabase });
      const updateAnnouncementFn = (async () => ({
        ok: true,
        value: { id: TARGET_ID, title: "x", updated_at: "2026-04-22T09:05:00.000Z" },
      })) as any;

      const response = await handleEditAnnouncement(
        harness.ctx,
        buildAction(),
        { updateAnnouncementFn }
      );
      assert.equal(response.status, 200);
      assert.equal(insertedMessages.length, 1, "the failing insert was still attempted");
    } finally {
      console.error = originalError;
    }
  });
});
