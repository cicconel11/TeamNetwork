/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";

const ORG_ID = "org-uuid-1";
const ADMIN_USER = { id: "admin-user", email: "admin@example.com" };

const { createAiPendingActionsCleanupHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/cleanup/handler.ts"
);

test("cleanup endpoint returns recovered and skipped counts", async () => {
  const cleanupCalls: any[] = [];

  const handler = createAiPendingActionsCleanupHandler({
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
        serviceSupabase: {},
      }) as any,
    cleanupStrandedPendingActions: async (_supabase, input) => {
      cleanupCalls.push(input);
      return { scanned: 3, recovered: 2, skipped: 1 };
    },
  });

  const response = await handler(new Request(`http://localhost/api/ai/${ORG_ID}/pending-actions/cleanup`, {
    method: "POST",
  }) as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body, { ok: true, scanned: 3, recovered: 2, skipped: 1 });
  assert.equal(cleanupCalls[0].organizationId, ORG_ID);
  assert.equal(cleanupCalls[0].failureMessage, "Execution timed out after confirmation");
});
