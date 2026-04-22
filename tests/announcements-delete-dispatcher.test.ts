/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleDeleteAnnouncement } from "@/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/dispatchers/announcements";
import type { PendingActionRecord } from "@/lib/ai/pending-actions";

// ─── Fixtures ───────────────────────────────────────────────────────────

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const THREAD_ID = "00000000-0000-4000-8000-000000000003";
const ACTION_ID = "00000000-0000-4000-8000-000000000004";
const TARGET_ID = "00000000-0000-4000-8000-000000000005";
const EXPECTED_UPDATED_AT = "2026-04-22T09:00:00.000Z";

function buildAction(
  overrides: Partial<PendingActionRecord<"delete_announcement">> = {}
): PendingActionRecord<"delete_announcement"> {
  return {
    id: ACTION_ID,
    organization_id: ORG_ID,
    user_id: USER_ID,
    thread_id: THREAD_ID,
    action_type: "delete_announcement",
    payload: {
      targetId: TARGET_ID,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      targetTitle: "Week 5 Practice",
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
  } as PendingActionRecord<"delete_announcement">;
}

function buildCtx(options: {
  serviceSupabase?: any;
  canUseDraftSessions?: boolean;
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
        return { updated: true };
      }) as any,
      clearDraftSessionFn: (async (_supabase: any, input: any) => {
        draftClears.push(input);
      }) as any,
    },
    insertedMessages,
    statusUpdates,
    draftClears,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("handleDeleteAnnouncement — success path", () => {
  let harness: ReturnType<typeof buildCtx>;
  beforeEach(() => {
    harness = buildCtx();
  });

  it("calls the primitive with targetId + expectedUpdatedAt and returns 200", async () => {
    let captured: any = null;
    const softDeleteAnnouncementFn = (async (req: any) => {
      captured = req;
      return {
        ok: true,
        value: {
          id: TARGET_ID,
          title: "Week 5 Practice",
          body: "body",
          organization_id: ORG_ID,
          updated_at: "2026-04-22T09:05:00.000Z",
          deleted_at: "2026-04-22T09:05:00.000Z",
        },
      };
    }) as any;

    const response = await handleDeleteAnnouncement(
      harness.ctx,
      buildAction(),
      { softDeleteAnnouncementFn }
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.announcement.id, TARGET_ID);
    assert.ok(body.announcement.deleted_at, "response should carry deleted_at");
    assert.equal(body.actionId, ACTION_ID);

    assert.ok(captured);
    assert.equal(captured.orgId, ORG_ID);
    assert.equal(captured.userId, USER_ID);
    assert.equal(captured.targetId, TARGET_ID);
    assert.equal(captured.expectedUpdatedAt, EXPECTED_UPDATED_AT);
  });

  it("writes the executed CAS with resultEntityType=announcement after the primitive succeeds", async () => {
    const softDeleteAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "x",
        updated_at: "2026-04-22T09:05:00.000Z",
        deleted_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleDeleteAnnouncement(harness.ctx, buildAction(), {
      softDeleteAnnouncementFn,
    });

    assert.equal(harness.statusUpdates.length, 1);
    assert.equal(harness.statusUpdates[0].status, "executed");
    assert.equal(harness.statusUpdates[0].expectedStatus, "confirmed");
    assert.equal(harness.statusUpdates[0].resultEntityType, "announcement");
    assert.equal(harness.statusUpdates[0].resultEntityId, TARGET_ID);
  });

  it("does NOT clear any draft session (delete_announcement is not a DraftSessionType)", async () => {
    const softDeleteAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "x",
        updated_at: "2026-04-22T09:05:00.000Z",
        deleted_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleDeleteAnnouncement(harness.ctx, buildAction(), {
      softDeleteAnnouncementFn,
    });

    assert.equal(
      harness.draftClears.length,
      0,
      "delete flow skips the draft-session collection phase entirely"
    );
  });

  it("inserts an ai_messages confirmation using the captured targetTitle and org-scoped URL", async () => {
    const softDeleteAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "Different Stored Title",
        updated_at: "2026-04-22T09:05:00.000Z",
        deleted_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleDeleteAnnouncement(harness.ctx, buildAction(), {
      softDeleteAnnouncementFn,
    });

    assert.equal(harness.insertedMessages.length, 1);
    const msg = harness.insertedMessages[0];
    assert.equal(msg.role, "assistant");
    assert.equal(msg.thread_id, THREAD_ID);
    assert.equal(msg.org_id, ORG_ID);
    assert.equal(msg.status, "complete");
    assert.match(
      msg.content,
      /Week 5 Practice/,
      "content should prefer the payload's targetTitle captured at prepare time"
    );
    assert.match(msg.content, /Deleted announcement/);
    assert.match(msg.content, /\/org\/announcements/);
  });

  it("falls back to result.value.title when targetTitle is absent", async () => {
    const softDeleteAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "Stored Row Title",
        updated_at: "2026-04-22T09:05:00.000Z",
        deleted_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleDeleteAnnouncement(
      harness.ctx,
      buildAction({
        payload: {
          targetId: TARGET_ID,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          targetTitle: null,
          orgSlug: "org",
        },
      }),
      { softDeleteAnnouncementFn }
    );

    assert.match(harness.insertedMessages[0].content, /Stored Row Title/);
  });

  it("renders plain text (no markdown link) when orgSlug is missing", async () => {
    const softDeleteAnnouncementFn = (async () => ({
      ok: true,
      value: {
        id: TARGET_ID,
        title: "x",
        updated_at: "2026-04-22T09:05:00.000Z",
        deleted_at: "2026-04-22T09:05:00.000Z",
      },
    })) as any;

    await handleDeleteAnnouncement(
      harness.ctx,
      buildAction({
        payload: {
          targetId: TARGET_ID,
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          targetTitle: "Plain",
          orgSlug: "",
        },
      }),
      { softDeleteAnnouncementFn }
    );

    assert.doesNotMatch(harness.insertedMessages[0].content, /\[.*\]\(/);
  });
});

describe("handleDeleteAnnouncement — typed-failure paths (no throw)", () => {
  for (const [status, errorKey] of [
    [403, "forbidden"],
    [404, "not_found"],
    [409, "stale_version"],
    [500, "delete_failed"],
  ] as const) {
    it(`rolls back confirmed→pending and returns ${status} with error=${errorKey}`, async () => {
      const harness = buildCtx();
      const softDeleteAnnouncementFn = (async () => ({
        ok: false,
        status,
        error: errorKey,
      })) as any;

      const response = await handleDeleteAnnouncement(
        harness.ctx,
        buildAction(),
        { softDeleteAnnouncementFn }
      );
      const body = await response.json();

      assert.equal(response.status, status);
      assert.equal(body.error, errorKey);

      assert.equal(harness.statusUpdates.length, 1);
      assert.equal(harness.statusUpdates[0].status, "pending");
      assert.equal(harness.statusUpdates[0].expectedStatus, "confirmed");

      assert.equal(harness.insertedMessages.length, 0, "no confirmation message on failure");
    });
  }

  it("forwards the details payload on 409 stale_version", async () => {
    const harness = buildCtx();
    const softDeleteAnnouncementFn = (async () => ({
      ok: false,
      status: 409,
      error: "stale_version",
      details: {
        expectedUpdatedAt: "A",
        currentUpdatedAt: "B",
      },
    })) as any;

    const response = await handleDeleteAnnouncement(
      harness.ctx,
      buildAction(),
      { softDeleteAnnouncementFn }
    );
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.deepEqual(body.details, {
      expectedUpdatedAt: "A",
      currentUpdatedAt: "B",
    });
  });
});

describe("handleDeleteAnnouncement — thrown-failure path (return-await regression)", () => {
  it("lets the rejection propagate (does not swallow it) so handler.ts outer try/catch can roll back", async () => {
    const harness = buildCtx();
    const softDeleteAnnouncementFn = (async () => {
      throw new Error("Supabase timeout");
    }) as any;

    await assert.rejects(
      handleDeleteAnnouncement(harness.ctx, buildAction(), { softDeleteAnnouncementFn }),
      { message: "Supabase timeout" }
    );

    assert.equal(harness.statusUpdates.length, 0);
    assert.equal(harness.insertedMessages.length, 0);
  });
});

describe("handleDeleteAnnouncement — ai_messages failure is logged, not fatal", () => {
  it("returns 200 with the deleted announcement even when ai_messages.insert errors", async () => {
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
      const softDeleteAnnouncementFn = (async () => ({
        ok: true,
        value: {
          id: TARGET_ID,
          title: "x",
          updated_at: "2026-04-22T09:05:00.000Z",
          deleted_at: "2026-04-22T09:05:00.000Z",
        },
      })) as any;

      const response = await handleDeleteAnnouncement(
        harness.ctx,
        buildAction(),
        { softDeleteAnnouncementFn }
      );
      assert.equal(response.status, 200);
      assert.equal(insertedMessages.length, 1);
    } finally {
      console.error = originalError;
    }
  });
});
