/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  executeToolCall,
  type ToolExecutionContext,
} from "../../../src/lib/ai/tools/executor.ts";

const ORG_ID = "org-uuid-access";
const USER_ID = "user-uuid-access";
const ORIGINAL_KILL = process.env.AI_MEMBER_ACCESS_KILL;

function liftKillSwitch() {
  process.env.AI_MEMBER_ACCESS_KILL = "0";
}

function restoreKillSwitch() {
  if (ORIGINAL_KILL === undefined) {
    delete process.env.AI_MEMBER_ACCESS_KILL;
  } else {
    process.env.AI_MEMBER_ACCESS_KILL = ORIGINAL_KILL;
  }
}

function createSupabaseStub() {
  return {
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (onFulfilled: any, onRejected?: any) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected),
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  };
}

function createTrackingSupabaseStub(label: string, options: {
  failOnFrom?: boolean;
  calls?: string[];
} = {}) {
  return {
    from: () => {
      options.calls?.push(label);
      if (options.failOnFrom) {
        throw new Error(`${label} client should not be used`);
      }

      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        then: (onFulfilled: any, onRejected?: any) =>
          Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled, onRejected),
      };
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: null }),
        remove: async () => ({ data: [], error: null }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  };
}

beforeEach(liftKillSwitch);
afterEach(restoreKillSwitch);

function makeCtx(
  authorization: ToolExecutionContext["authorization"],
  overrides: Partial<ToolExecutionContext> = {},
): ToolExecutionContext {
  return {
    orgId: ORG_ID,
    userId: USER_ID,
    serviceSupabase: createSupabaseStub() as any,
    authorization,
    ...overrides,
  };
}

test("executor rejects a disallowed tool for active_member even when requested directly", async () => {
  const result = await executeToolCall(
    makeCtx({
      kind: "preverified_role",
      source: "ai_org_context",
      role: "active_member",
    }),
    { name: "prepare_announcement", args: { title: "x", body: "y" } },
  );

  assert.equal(result.kind, "forbidden");
});

test("executor rejects enterprise tools for active_member even with enterprise role", async () => {
  const result = await executeToolCall(
    makeCtx(
      {
        kind: "preverified_role",
        source: "ai_org_context",
        role: "active_member",
        },
      { enterpriseId: "ent-1", enterpriseRole: "owner" },
    ),
    { name: "list_enterprise_alumni", args: {} },
  );

  assert.equal(result.kind, "forbidden");
});

test("executor rejects everything for parent role", async () => {
  const result = await executeToolCall(
    makeCtx({
      kind: "preverified_role",
      source: "ai_org_context",
      role: "parent",
    }),
    { name: "list_announcements", args: {} },
  );

  assert.equal(result.kind, "forbidden");
});

test("executor rejects all non-admin roles when kill switch is active", async () => {
  process.env.AI_MEMBER_ACCESS_KILL = "1";
  const result = await executeToolCall(
    makeCtx({
      kind: "preverified_role",
      source: "ai_org_context",
      role: "active_member",
    }),
    { name: "list_announcements", args: {} },
  );

  assert.equal(result.kind, "forbidden");
});

test("executor allows active_member safe tools when policy is green", async () => {
  const result = await executeToolCall(
    makeCtx(
      {
        kind: "preverified_role",
        source: "ai_org_context",
        role: "active_member",
        },
      { supabase: createSupabaseStub() as any },
    ),
    { name: "list_announcements", args: {} },
  );

  // `ok` means policy passed and the (stubbed, empty) tool ran. Any non-`forbidden`
  // result proves the policy didn't block the call.
  assert.notEqual(result.kind, "forbidden");
});

test("executor uses auth-bound supabase for active_member safe read tools", async () => {
  const calls: string[] = [];
  const result = await executeToolCall(
    makeCtx(
      {
        kind: "preverified_role",
        source: "ai_org_context",
        role: "active_member",
        },
      {
        supabase: createTrackingSupabaseStub("auth", { calls }) as any,
        serviceSupabase: createTrackingSupabaseStub("service", { failOnFrom: true, calls }) as any,
      },
    ),
    { name: "list_announcements", args: {} },
  );

  assert.notEqual(result.kind, "forbidden");
  assert.deepEqual(calls, ["auth"]);
});

test("executor rejects non-admin safe reads when auth-bound supabase is unavailable", async () => {
  const result = await executeToolCall(
    makeCtx({
      kind: "preverified_role",
      source: "ai_org_context",
      role: "active_member",
    }),
    { name: "list_announcements", args: {} },
  );

  assert.equal(result.kind, "auth_error");
});

test("executor preserves admin access to the full tool surface", async () => {
  const result = await executeToolCall(
    makeCtx({
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    { name: "list_members", args: {} },
  );

  assert.notEqual(result.kind, "forbidden");
});
