/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../../../src/lib/ai/tools/executor.ts";
import type { ToolExecutionContext } from "../../../src/lib/ai/tools/executor.ts";

const ORG_ID = "org-uuid-1";

function createToolSupabaseStub(overrides: Record<string, any> = {}) {
  const queries: Array<{ table: string; filters: any[]; method: string }> = [];

  function from(table: string) {
    const entry = { table, filters: [] as any[], method: "select" };
    queries.push(entry);

    const builder: Record<string, any> = {
      select(columns: string, opts?: any) {
        entry.method = opts?.head ? "count" : "select";
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
      gte(col: string, val: unknown) {
        entry.filters.push({ col, op: "gte", val });
        return builder;
      },
      lt(col: string, val: unknown) {
        entry.filters.push({ col, op: "lt", val });
        return builder;
      },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle() {
        return Promise.resolve(overrides[table]?.maybeSingle ?? { data: null, error: null });
      },
      single() {
        return Promise.resolve(overrides[table]?.single ?? { data: null, error: null });
      },
    };

    builder.then = (onFulfilled: any, onRejected?: any) => {
      const result = overrides[table]?.select ?? { data: [], error: null, count: 0 };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    };

    return builder;
  }

  return { from, queries };
}

let ctx: ToolExecutionContext;
let stub: ReturnType<typeof createToolSupabaseStub>;

beforeEach(() => {
  stub = createToolSupabaseStub({
    members: {
      select: { data: [{ id: "m1", name: "Alice", email: "a@b.com", status: "active" }], error: null },
    },
    events: {
      select: { data: [{ id: "e1", title: "Spring Gala", start_date: "2026-04-01" }], error: null },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };
});

test("list_members returns org-scoped members", async () => {
  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(Array.isArray(result.data));
    assert.equal((result.data as any[]).length, 1);
  }
  const memberQuery = stub.queries.find((q) => q.table === "members");
  assert.ok(memberQuery);
  assert.ok(memberQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "deleted_at" && f.val === null));
});

test("list_members with limit", async () => {
  const result = await executeToolCall(ctx, { name: "list_members", args: { limit: 5 } });
  assert.equal(result.ok, true);
});

test("list_events returns upcoming events by default", async () => {
  const result = await executeToolCall(ctx, { name: "list_events", args: { upcoming: true } });
  assert.equal(result.ok, true);
});

test("list_events returns past events", async () => {
  const result = await executeToolCall(ctx, { name: "list_events", args: { upcoming: false } });
  assert.equal(result.ok, true);
  const eventQuery = stub.queries.find((q) => q.table === "events");
  assert.ok(eventQuery);
  assert.ok(eventQuery.filters.some((f: any) => f.col === "start_date" && f.op === "lt"));
});

test("get_org_stats returns counts object", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: [], error: null, count: 42 } },
    alumni: { select: { data: [], error: null, count: 10 } },
    parents: { select: { data: [], error: null, count: 5 } },
    events: { select: { data: [], error: null, count: 3 } },
    organization_donation_stats: {
      maybeSingle: { data: { total_amount_cents: 50000, donation_count: 12 }, error: null },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };
  const result = await executeToolCall(ctx, { name: "get_org_stats", args: {} });
  assert.equal(result.ok, true);
  if (result.ok) {
    const stats = result.data as any;
    assert.equal(stats.active_members, 42);
    assert.equal(stats.alumni, 10);
    assert.equal(stats.parents, 5);
    assert.equal(stats.upcoming_events, 3);
  }
});

test("invalid args returns ok false (amendment: fail on malformed)", async () => {
  const result = await executeToolCall(ctx, {
    name: "list_members",
    args: { limit: 999 } as any,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /invalid/i);
  }
});

test("DB error returns ok false and does not throw", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: null, error: { message: "connection refused" } } },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };
  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.equal(result.ok, false);
});

test("get_org_stats fails closed when a count query fails", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: null, error: { message: "connection refused" }, count: null } },
    alumni: { select: { data: [], error: null, count: 10 } },
    parents: { select: { data: [], error: null, count: 5 } },
    events: { select: { data: [], error: null, count: 3 } },
    organization_donation_stats: {
      maybeSingle: { data: { total_amount_cents: 50000, donation_count: 12 }, error: null },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "get_org_stats", args: {} });

  assert.equal(result.ok, false);
});

test("unknown tool name returns ok false", async () => {
  const result = await executeToolCall(ctx, { name: "hack_the_planet" as any, args: {} });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /unknown/i);
  }
});
