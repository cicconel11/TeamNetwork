/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";

const ORG_ID = "org-uuid-1";
const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = { id: "admin-user", email: "admin@example.com" };

const { createAiPendingActionConfirmHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts"
);
const { createAiPendingActionCancelHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/[actionId]/cancel/handler.ts"
);

function buildRequest() {
  return new Request(`http://localhost/api/ai/${ORG_ID}/pending-actions/${ACTION_ID}/confirm`, {
    method: "POST",
  });
}

test("confirm executes create_job_posting and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
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
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_job_posting",
        payload: {
          title: "Senior Product Designer",
          company: "Acme Corp",
          location: "San Francisco, CA",
          industry: "SaaS",
          experience_level: "senior",
          description: "Lead product design across our platform.",
          application_url: "https://example.com/jobs/senior-product-designer",
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createJobPosting: async () =>
      ({
        ok: true,
        status: 201,
        job: {
          id: "job-123",
          title: "Senior Product Designer",
        },
      }) as any,
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created job posting/);
  assert.match(String(insertedMessages[0].content), /upenn-sprint-football\/jobs\/job-123/);
});

test("confirm executes create_discussion_thread and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
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
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_discussion_thread",
        payload: {
          title: "Spring Fundraising Volunteers",
          body: "Let's organize volunteer assignments for the spring fundraiser.",
          mediaIds: ["11111111-1111-4111-8111-111111111111"],
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createDiscussionThread: async () =>
      ({
        ok: true,
        status: 201,
        thread: {
          id: "thread-123",
          title: "Spring Fundraising Volunteers",
        },
        threadUrl: "/upenn-sprint-football/messages/threads/thread-123",
      }) as any,
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "discussion_thread");
  assert.equal(updatedStatuses[1].resultEntityId, "thread-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created discussion thread/);
  assert.match(
    String(insertedMessages[0].content),
    /upenn-sprint-football\/messages\/threads\/thread-123/
  );
});

test("cancel marks the pending action cancelled", async () => {
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionCancelHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from() {
            return {
              insert() {
                return Promise.resolve({ error: null });
              },
            };
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_job_posting",
        payload: {},
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "cancelled");
});

// --- Regression tests ---

function buildPendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    organization_id: ORG_ID,
    user_id: ADMIN_USER.id,
    thread_id: THREAD_ID,
    action_type: "create_job_posting",
    payload: {
      title: "Senior Product Designer",
      company: "Acme Corp",
      location: "San Francisco, CA",
      industry: "SaaS",
      experience_level: "senior",
      description: "Lead product design across our platform.",
      application_url: "https://example.com/jobs/senior-product-designer",
      orgSlug: "upenn-sprint-football",
    },
    status: "pending",
    expires_at: "2099-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    executed_at: null,
    result_entity_type: null,
    result_entity_id: null,
    ...overrides,
  };
}

function buildBaseDeps(overrides: Record<string, unknown> = {}) {
  return {
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert() {
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    clearDraftSession: async () => {},
    ...overrides,
  };
}

test("CAS race: second concurrent confirm gets idempotent replay", async () => {
  let casCallCount = 0;
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () => {
      // On re-read after CAS failure, return executed state
      if (casCallCount > 0) {
        return buildPendingAction({
          status: "executed",
          result_entity_type: "job_posting",
          result_entity_id: "job-123",
        }) as any;
      }
      return buildPendingAction() as any;
    },
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      casCallCount++;
      if (payload.status === "confirmed" && payload.expectedStatus === "pending") {
        // Simulate CAS failure — another request claimed the row first
        return { updated: false };
      }
      return { updated: true };
    },
    createJobPosting: async () => {
      throw new Error("should not be called on CAS failure");
    },
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true);
  assert.equal(body.resultEntityType, "job_posting");
});

test("exception during write rolls back to pending", async () => {
  const updatedStatuses: any[] = [];
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () => buildPendingAction() as any,
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createJobPosting: async () => {
      throw new Error("Supabase timeout");
    },
  });

  await assert.rejects(
    handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    }),
    { message: "Supabase timeout" }
  );

  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "pending");
  assert.equal(updatedStatuses[1].expectedStatus, "confirmed");
});

test("rollback failure logs structured error and re-throws", async () => {
  const logged: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => logged.push(args);

  try {
    const handler = createAiPendingActionConfirmHandler({
      ...buildBaseDeps(),
      getPendingAction: async () => buildPendingAction() as any,
      updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
        if (payload.status === "confirmed") return { updated: true };
        // Rollback fails
        throw new Error("rollback connection lost");
      },
      createJobPosting: async () => {
        throw new Error("Supabase timeout");
      },
    });

    await assert.rejects(
      handler(buildRequest() as any, {
        params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
      }),
      { message: "Supabase timeout" }
    );

    const rollbackLog = logged.find(
      (entry) => typeof entry[0] === "string" && entry[0].includes("rollback failed")
    );
    assert.ok(rollbackLog, "should log rollback failure");
    assert.equal(rollbackLog[1].actionId, ACTION_ID);
  } finally {
    console.error = originalError;
  }
});

test("failed ai_messages insert is logged but returns 200", async () => {
  const logged: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => logged.push(args);

  try {
    const handler = createAiPendingActionConfirmHandler({
      ...buildBaseDeps({
        getAiOrgContext: async () =>
          ({
            ok: true,
            orgId: ORG_ID,
            userId: ADMIN_USER.id,
            role: "admin",
            supabase: null,
            serviceSupabase: {
              from(table: string) {
                if (table === "ai_messages") {
                  return {
                    insert() {
                      return Promise.resolve({ error: { message: "insert failed" } });
                    },
                  };
                }
                throw new Error(`unexpected table ${table}`);
              },
            },
          }) as any,
      }),
      getPendingAction: async () => buildPendingAction() as any,
      updatePendingActionStatus: async () => ({ updated: true }),
      createJobPosting: async () =>
        ({
          ok: true,
          status: 201,
          job: { id: "job-456", title: "Designer" },
        }) as any,
    });

    const response = await handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);

    const msgLog = logged.find(
      (entry) => typeof entry[0] === "string" && entry[0].includes("failed to insert confirmation")
    );
    assert.ok(msgLog, "should log message insert failure");
  } finally {
    console.error = originalError;
  }
});

test("cancel returns 409 when action is in confirmed (in-progress) state", async () => {
  const handler = createAiPendingActionCancelHandler({
    ...buildBaseDeps(),
    getPendingAction: async () =>
      buildPendingAction({ status: "confirmed" }) as any,
    updatePendingActionStatus: async () => ({ updated: true }),
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.reason, "in_progress");
});

test("unsupported action type rolls back confirmed claim", async () => {
  const updatedStatuses: any[] = [];
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () =>
      buildPendingAction({ action_type: "unsupported_action" }) as any,
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
  });

  await assert.rejects(
    handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    }),
    { message: "Unsupported pending action type: unsupported_action" }
  );

  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[0].expectedStatus, "pending");
  assert.equal(updatedStatuses[1].status, "pending");
  assert.equal(updatedStatuses[1].expectedStatus, "confirmed");
});

test("cancel returns 410 for expired pending action without cancel message", async () => {
  const insertedMessages: any[] = [];
  const handler = createAiPendingActionCancelHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from() {
            return {
              insert(payload: Record<string, unknown>) {
                insertedMessages.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        },
      }) as any,
    getPendingAction: async () =>
      buildPendingAction({ expires_at: "2000-01-01T00:00:00.000Z" }) as any,
    updatePendingActionStatus: async () => ({ updated: true }),
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.error, "Pending action has expired");
  assert.equal(insertedMessages.length, 0);
});
