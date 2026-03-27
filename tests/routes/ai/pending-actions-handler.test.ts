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
    },
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "cancelled");
});
