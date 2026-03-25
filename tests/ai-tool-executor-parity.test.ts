/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../src/lib/ai/tools/executor.ts";
import type { ToolExecutionContext, ToolExecutionResult } from "../src/lib/ai/tools/executor.ts";

const ORG_ID = "org-uuid-1";
const USER_ID = "org-admin-user";

function createToolSupabaseStub(overrides: Record<string, any> = {}) {
  const queries: Array<{
    table: string;
    filters: any[];
    columns?: string;
    orderBys?: Array<{ column: string; ascending: boolean }>;
    limitValue?: number;
  }> = [];

  function from(table: string) {
    const entry = {
      table,
      filters: [] as any[],
      columns: undefined as string | undefined,
      orderBys: [] as Array<{ column: string; ascending: boolean }>,
      limitValue: undefined as number | undefined,
    };
    queries.push(entry);

    const builder: Record<string, any> = {
      select(columns: string) {
        entry.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        entry.filters.push({ col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        entry.filters.push({ col, val });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        entry.orderBys.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      limit(value: number) {
        entry.limitValue = value;
        return builder;
      },
      maybeSingle() {
        if (table === "user_organization_roles") {
          return Promise.resolve({ data: { role: "admin", status: "active" }, error: null });
        }
        return Promise.resolve(overrides[table]?.maybeSingle ?? { data: null, error: null });
      },
    };

    builder.then = (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(overrides[table]?.select ?? { data: [], error: null }).then(
        onFulfilled,
        onRejected
      );

    return builder;
  }

  return {
    from,
    rpc: async (name: string) => {
      if (name === "get_subscription_status") {
        return { data: overrides.rpc?.get_subscription_status ?? [], error: null };
      }

      return { data: null, error: { message: `missing rpc ${name}` } };
    },
    queries,
  };
}

function makeCtx(serviceSupabase: any): ToolExecutionContext {
  return {
    orgId: ORG_ID,
    userId: USER_ID,
    serviceSupabase,
    authorization: { kind: "verify_membership" },
  };
}

function expectOk(result: ToolExecutionResult): Extract<ToolExecutionResult, { kind: "ok" }> {
  assert.equal(result.kind, "ok");
  return result as Extract<ToolExecutionResult, { kind: "ok" }>;
}

test("list_announcements returns org-scoped announcements", async () => {
  const stub = createToolSupabaseStub({
    announcements: {
      select: {
        data: [
          {
            id: "a1",
            title: "Welcome back",
            body: "Practice starts Monday in the main gym.",
            audience: "all",
            is_pinned: true,
            published_at: "2026-03-20T12:00:00Z",
            created_at: "2026-03-20T12:00:00Z",
          },
        ],
        error: null,
      },
    },
  });

  const result = expectOk(
    await executeToolCall(makeCtx(stub as any), { name: "list_announcements", args: {} })
  );

  assert.deepEqual((result.data as any[])[0], {
    id: "a1",
    title: "Welcome back",
    audience: "all",
    is_pinned: true,
    published_at: "2026-03-20T12:00:00Z",
    body_preview: "Practice starts Monday in the main gym.",
  });

  const announcementQuery = stub.queries.find((query) => query.table === "announcements");
  assert.deepEqual(announcementQuery?.orderBys, [
    { column: "is_pinned", ascending: false },
    { column: "published_at", ascending: false },
  ]);
});

test("find_navigation_targets returns org-scoped action links", async () => {
  const stub = createToolSupabaseStub({
    organizations: {
      maybeSingle: {
        data: { slug: "acme", nav_config: null },
        error: null,
      },
    },
    rpc: {
      get_subscription_status: [{ status: "active", alumni_bucket: "all", parents_bucket: "none" }],
    },
  });

  const result = expectOk(
    await executeToolCall(makeCtx(stub as any), {
      name: "find_navigation_targets",
      args: { query: "create announcement" },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.matches[0].label, "New Announcement");
  assert.equal(payload.matches[0].href, "/acme/announcements/new");
});

test("find_navigation_targets respects org access flags when searching", async () => {
  const stub = createToolSupabaseStub({
    organizations: {
      maybeSingle: {
        data: { slug: "acme", nav_config: null },
        error: null,
      },
    },
    rpc: {
      get_subscription_status: [{ status: "active", alumni_bucket: "none", parents_bucket: "none" }],
    },
  });

  const result = expectOk(
    await executeToolCall(makeCtx(stub as any), {
      name: "find_navigation_targets",
      args: { query: "open alumni" },
    })
  );

  assert.equal((result.data as any).state, "not_found");
});
