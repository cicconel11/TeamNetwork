/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = { id: "33333333-3333-4333-8333-333333333333", email: "admin@example.com" };
const TARGET_USER = "44444444-4444-4444-8444-444444444444";
let requestCounter = 1;

const { createAiPendingActionConfirmHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts"
);

function buildRequest() {
  return new Request(`http://localhost/api/ai/${ORG_ID}/pending-actions/${ACTION_ID}/confirm`, {
    method: "POST",
    headers: {
      "x-forwarded-for": `127.0.0.${requestCounter++}`,
    },
  });
}

type ConfirmCase = {
  name: string;
  /** seed setup that should make executeMemberRoleChange land on this reason */
  seed: (stub: ReturnType<typeof createSupabaseStub>) => void;
  /** override target user id (defaults TARGET_USER) */
  targetUserId?: string;
  /** new role to request */
  newRole?: string;
  expectedReason:
    | "actor_not_admin"
    | "last_admin_self_demotion"
    | "last_admin_target_demotion"
    | "alumni_upgrade_required"
    | "parent_upgrade_required"
    | "no_change"
    | "target_not_found";
  expectedMessage: string;
  expectedHttpStatus: number;
};

function seedSubscriptionEnabled(stub: ReturnType<typeof createSupabaseStub>) {
  stub.seed("organization_subscriptions", [
    { organization_id: ORG_ID, status: "active", alumni_bucket: "0-250", parents_bucket: "0-250" },
  ]);
}

function buildServiceSupabase(stub: ReturnType<typeof createSupabaseStub>, recorded: { messages: any[] }) {
  return {
    from(table: string) {
      if (table === "ai_messages") {
        return {
          insert(payload: Record<string, unknown>) {
            recorded.messages.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      return stub.from(table);
    },
    rpc: stub.rpc,
  };
}

const TERMINAL_CASES: ConfirmCase[] = [
  {
    name: "actor_not_admin",
    seed: (stub) => {
      seedSubscriptionEnabled(stub);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "active_member", status: "active" },
        { organization_id: ORG_ID, user_id: TARGET_USER, role: "active_member", status: "active" },
      ]);
    },
    newRole: "alumni",
    expectedReason: "actor_not_admin",
    expectedMessage: "Only active admins can change member roles.",
    expectedHttpStatus: 409,
  },
  {
    name: "last_admin_self_demotion",
    seed: (stub) => {
      seedSubscriptionEnabled(stub);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
      ]);
    },
    targetUserId: ADMIN_USER.id,
    newRole: "alumni",
    expectedReason: "last_admin_self_demotion",
    expectedMessage: "You are the only admin in this organization.",
    expectedHttpStatus: 409,
  },
  {
    name: "last_admin_target_demotion",
    seed: (stub) => {
      seedSubscriptionEnabled(stub);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
        { organization_id: ORG_ID, user_id: TARGET_USER, role: "admin", status: "revoked" },
      ]);
    },
    newRole: "alumni",
    expectedReason: "last_admin_target_demotion",
    expectedMessage: "Cannot demote the only admin.",
    expectedHttpStatus: 409,
  },
  {
    name: "alumni_upgrade_required",
    seed: (stub) => {
      stub.seed("organization_subscriptions", [
        { organization_id: ORG_ID, status: "active", alumni_bucket: "none", parents_bucket: "none" },
      ]);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
        { organization_id: ORG_ID, user_id: TARGET_USER, role: "active_member", status: "active" },
      ]);
    },
    newRole: "alumni",
    expectedReason: "alumni_upgrade_required",
    expectedMessage: "Upgrade required for alumni role.",
    expectedHttpStatus: 409,
  },
  {
    name: "parent_upgrade_required",
    seed: (stub) => {
      stub.seed("organization_subscriptions", [
        { organization_id: ORG_ID, status: "active", alumni_bucket: "none", parents_bucket: "none" },
      ]);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
        { organization_id: ORG_ID, user_id: TARGET_USER, role: "active_member", status: "active" },
      ]);
    },
    newRole: "parent",
    expectedReason: "parent_upgrade_required",
    expectedMessage: "Upgrade required for parent role.",
    expectedHttpStatus: 409,
  },
  {
    name: "no_change",
    seed: (stub) => {
      seedSubscriptionEnabled(stub);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
        { organization_id: ORG_ID, user_id: TARGET_USER, role: "alumni", status: "active" },
      ]);
    },
    newRole: "alumni",
    expectedReason: "no_change",
    expectedMessage: "No member role or status change is needed.",
    expectedHttpStatus: 400,
  },
  {
    name: "target_not_found (membership row missing)",
    seed: (stub) => {
      seedSubscriptionEnabled(stub);
      stub.seed("user_organization_roles", [
        { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
      ]);
    },
    newRole: "alumni",
    expectedReason: "target_not_found",
    expectedMessage: "Member not found in this organization.",
    expectedHttpStatus: 400,
  },
];

type TransientCase = {
  name: string;
  /** raw rpc error that the executor must NOT leak through */
  rawError: { code?: string; message: string };
  expectedSanitizedMessage: string;
};

const TRANSIENT_CASES: TransientCase[] = [
  {
    name: "deadlock detected",
    rawError: { code: "40P01", message: "deadlock detected; database table user_organization_roles" },
    expectedSanitizedMessage: "Could not update member role. Please try again.",
  },
  {
    name: "syntax error leaks schema",
    rawError: { message: 'syntax error at or near "FROM" while updating user_organization_roles' },
    expectedSanitizedMessage: "Could not update member role. Please try again.",
  },
];

for (const c of TRANSIENT_CASES) {
  test(`confirm member_role_change: transient (${c.name}) → status=pending with sanitized error`, async () => {
    const stub = createSupabaseStub();
    seedSubscriptionEnabled(stub);
    stub.seed("user_organization_roles", [
      { organization_id: ORG_ID, user_id: ADMIN_USER.id, role: "admin", status: "active" },
      { organization_id: ORG_ID, user_id: TARGET_USER, role: "active_member", status: "active" },
    ]);
    stub.registerRpc("execute_member_role_change", () => {
      const err = new Error(c.rawError.message) as Error & { code?: string };
      if (c.rawError.code) err.code = c.rawError.code;
      throw err;
    });

    const recorded = { messages: [] as any[] };
    const updatedStatuses: any[] = [];

    const handler = createAiPendingActionConfirmHandler({
      createClient: async () =>
        ({ auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) } }) as any,
      getAiOrgContext: async () =>
        ({
          ok: true,
          orgId: ORG_ID,
          userId: ADMIN_USER.id,
          role: "admin",
          supabase: null,
          serviceSupabase: buildServiceSupabase(stub, recorded),
        }) as any,
      getPendingAction: async () =>
        ({
          id: ACTION_ID,
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: THREAD_ID,
          action_type: "member_role_change",
          payload: {
            target_user_id: TARGET_USER,
            target_display_name: "Target User",
            new_role: "alumni",
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
      clearDraftSession: async () => {},
    });

    const response = await handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error, c.expectedSanitizedMessage);
    assert.notEqual(body.error, c.rawError.message, "raw DB message must not leak to response");

    const final = updatedStatuses[updatedStatuses.length - 1];
    assert.equal(final.status, "pending", "transient failures must remain retryable");
    assert.equal(final.errorMessage, null);

    const target = stub.getRows("user_organization_roles").find((r) => r.user_id === TARGET_USER);
    assert.equal(target?.role, "active_member");
  });
}

for (const c of TERMINAL_CASES) {
  test(`confirm member_role_change: ${c.name} → status=failed with sanitized error`, async () => {
    const stub = createSupabaseStub();
    c.seed(stub);
    const recorded = { messages: [] as any[] };
    const updatedStatuses: any[] = [];

    const handler = createAiPendingActionConfirmHandler({
      createClient: async () =>
        ({ auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) } }) as any,
      getAiOrgContext: async () =>
        ({
          ok: true,
          orgId: ORG_ID,
          userId: ADMIN_USER.id,
          role: "admin",
          supabase: null,
          serviceSupabase: buildServiceSupabase(stub, recorded),
        }) as any,
      getPendingAction: async () =>
        ({
          id: ACTION_ID,
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: THREAD_ID,
          action_type: "member_role_change",
          payload: {
            target_user_id: c.targetUserId ?? TARGET_USER,
            target_display_name: "Target User",
            new_role: c.newRole,
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
      clearDraftSession: async () => {},
    });

    const response = await handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    });
    const body = await response.json();

    assert.equal(response.status, c.expectedHttpStatus, `expected ${c.expectedHttpStatus}, got ${response.status}: ${JSON.stringify(body)}`);
    assert.equal(body.error, c.expectedMessage);

    // First call confirms (pending → confirmed); second call lands on failed.
    assert.equal(updatedStatuses[0].status, "confirmed");
    const final = updatedStatuses[updatedStatuses.length - 1];
    assert.equal(final.status, "failed", `${c.name} should be terminal failed`);
    assert.equal(final.errorMessage, c.expectedMessage);
    assert.equal(final.expectedStatus, "confirmed");
  });
}
