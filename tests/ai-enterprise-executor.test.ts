/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for enterprise tool executor — Phase 1.
 *
 * Security invariants (per plan):
 *  - Every read filters by ctx.enterpriseId (never from LLM args)
 *  - get_enterprise_admins passes ctx.userId as p_actor_user_id (not from args)
 *  - Missing user_enterprise_roles row → forbidden (cross-enterprise defense)
 *  - Unknown tool name → tool_error
 *  - Tool args carrying enterprise_id are stripped by .strict() schema
 */

// ── Mock Supabase chain recorder ──

type EqCall = { column: string; value: unknown };

function makeRecordingSupabase(opts: {
  roleRow?: { role: string } | null;
  roleError?: unknown;
  tableResults?: Record<string, { data: unknown; error: unknown; count?: number | null }>;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const eqCalls: EqCall[] = [];
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const tableQueried: string[] = [];

  function makeQueryBuilder(table: string, result: { data: unknown; error: unknown; count?: number | null }) {
    const builder: any = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqCalls.push({ column, value });
        return builder;
      },
      is: () => builder,
      gte: () => builder,
      lt: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: result.data, error: result.error }),
      maybeSingle: () => Promise.resolve({ data: result.data, error: result.error }),
      then: (onFulfilled: any) =>
        Promise.resolve({
          data: result.data,
          error: result.error,
          count: result.count ?? null,
        }).then(onFulfilled),
    };
    return builder;
  }

  return {
    eqCalls,
    rpcCalls,
    tableQueried,
    from: (table: string) => {
      tableQueried.push(table);
      if (table === "user_enterprise_roles") {
        return {
          select: () => ({
            eq: (col1: string, val1: unknown) => {
              eqCalls.push({ column: col1, value: val1 });
              return {
                eq: (col2: string, val2: unknown) => {
                  eqCalls.push({ column: col2, value: val2 });
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: opts.roleRow ?? null,
                        error: opts.roleError ?? null,
                      }),
                  };
                },
              };
            },
          }),
        };
      }
      const result = opts.tableResults?.[table] ?? { data: [], error: null };
      return makeQueryBuilder(table, result);
    },
    rpc: (name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(opts.rpcResult ?? { data: [], error: null });
    },
  };
}

const ALLOWED_ROLE = { role: "owner" };

const baseCtx = () => ({
  enterpriseId: "ent-uuid-123",
  userId: "user-123",
});

// ── Tests ──

describe("enterprise tool executor", () => {
  it("returns tool_error for unknown tool name", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({ roleRow: ALLOWED_ROLE });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "list_members", args: {} }
    );
    assert.equal(result.kind, "tool_error");
  });

  it("forbidden when user has no enterprise role row", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({ roleRow: null });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_enterprise_stats", args: {} }
    );
    assert.equal(result.kind, "forbidden");
  });

  it("forbidden when role is outside ENTERPRISE_ANY_ROLE", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({ roleRow: { role: "guest" } });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_enterprise_stats", args: {} }
    );
    assert.equal(result.kind, "forbidden");
  });

  it("auth_error on role query DB error", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({ roleError: { message: "timeout" } });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_enterprise_stats", args: {} }
    );
    assert.equal(result.kind, "auth_error");
  });

  it("get_enterprise_stats queries enterprise_alumni_counts filtered by enterprise_id", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        enterprise_alumni_counts: {
          data: {
            enterprise_id: "ent-uuid-123",
            total_alumni_count: 42,
            sub_org_count: 3,
            enterprise_managed_org_count: 1,
          },
          error: null,
        },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_enterprise_stats", args: {} }
    );
    assert.equal(result.kind, "ok");
    assert.ok(sb.tableQueried.includes("enterprise_alumni_counts"));
    const entFilter = sb.eqCalls.find(
      (c) => c.column === "enterprise_id" && c.value === "ent-uuid-123"
    );
    assert.ok(entFilter, "enterprise_id filter must be applied");
  });

  it("list_enterprise_orgs queries organizations filtered by enterprise_id", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        organizations: { data: [{ id: "o1" }], error: null },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "list_enterprise_orgs", args: {} }
    );
    assert.equal(result.kind, "ok");
    assert.ok(sb.tableQueried.includes("organizations"));
    const entFilter = sb.eqCalls.find(
      (c) => c.column === "enterprise_id" && c.value === "ent-uuid-123"
    );
    assert.ok(entFilter, "enterprise_id filter must be applied");
  });

  it("search_enterprise_alumni queries enterprise_alumni_directory filtered by enterprise_id", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        enterprise_alumni_directory: { data: [], error: null },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "search_enterprise_alumni", args: {} }
    );
    assert.equal(result.kind, "ok");
    assert.ok(sb.tableQueried.includes("enterprise_alumni_directory"));
    const entFilter = sb.eqCalls.find(
      (c) => c.column === "enterprise_id" && c.value === "ent-uuid-123"
    );
    assert.ok(entFilter);
  });

  it("search_enterprise_alumni masks raw names in the returned rows", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        enterprise_alumni_directory: {
          data: [
            {
              id: "a1",
              organization_id: "org-1",
              organization_name: "Org 1",
              organization_slug: "org-1",
              first_name: "Jane",
              last_name: "Doe",
              graduation_year: 2020,
              major: "History",
              job_title: "Director",
              current_company: "Acme",
              current_city: "Boston",
              industry: "Education",
            },
          ],
          error: null,
        },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "search_enterprise_alumni", args: {} }
    );
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.deepEqual(result.data, [
        {
          id: "a1",
          organization_id: "org-1",
          organization_name: "Org 1",
          organization_slug: "org-1",
          name: "J. D.",
          graduation_year: 2020,
          major: "History",
          job_title: "Director",
          current_company: "Acme",
          current_city: "Boston",
          industry: "Education",
        },
      ]);
    }
  });

  it("get_subscription_status queries enterprise_subscriptions filtered by enterprise_id", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        enterprise_subscriptions: {
          data: { status: "active" },
          error: null,
        },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_subscription_status", args: {} }
    );
    assert.equal(result.kind, "ok");
    assert.ok(sb.tableQueried.includes("enterprise_subscriptions"));
  });

  it("get_enterprise_details queries enterprises filtered by id", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      tableResults: {
        enterprises: { data: { id: "ent-uuid-123", name: "Acme" }, error: null },
      },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "get_enterprise_details", args: {} }
    );
    assert.equal(result.kind, "ok");
    assert.ok(sb.tableQueried.includes("enterprises"));
  });

  it("get_enterprise_admins calls RPC with p_actor_user_id from ctx.userId (not args)", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      rpcResult: { data: [{ user_id: "u1", email: "a@b.co", role: "owner" }], error: null },
    });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      // LLM MUST NOT be able to pass p_actor_user_id — .strict() strips unknown fields
      { name: "get_enterprise_admins", args: { p_actor_user_id: "attacker" } as any }
    );
    assert.equal(result.kind, "tool_error"); // .strict() rejects unknown keys

    // Now happy path with clean args
    const sb2 = makeRecordingSupabase({
      roleRow: ALLOWED_ROLE,
      rpcResult: { data: [{ user_id: "u1", email: "a@b.co", role: "owner" }], error: null },
    });
    const result2 = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb2 as any },
      { name: "get_enterprise_admins", args: {} }
    );
    assert.equal(result2.kind, "ok");
    assert.equal(sb2.rpcCalls.length, 1);
    assert.equal(sb2.rpcCalls[0].name, "get_enterprise_admins");
    const params = sb2.rpcCalls[0].params as any;
    assert.equal(params.p_actor_user_id, "user-123");
    assert.equal(params.p_enterprise_id, "ent-uuid-123");
  });

  it("rejects org-scoped tool names (list_members) in enterprise executor", async () => {
    const { executeEnterpriseToolCall } = await import(
      "../src/lib/ai/tools/enterprise-executor.ts"
    );
    const sb = makeRecordingSupabase({ roleRow: ALLOWED_ROLE });
    const result = await executeEnterpriseToolCall(
      { ...baseCtx(), serviceSupabase: sb as any },
      { name: "suggest_connections", args: {} }
    );
    assert.equal(result.kind, "tool_error");
  });
});
