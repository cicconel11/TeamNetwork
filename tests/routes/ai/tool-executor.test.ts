/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../../../src/lib/ai/tools/executor.ts";
import type { ToolExecutionContext } from "../../../src/lib/ai/tools/executor.ts";

const ORG_ID = "org-uuid-1";

function createToolSupabaseStub(overrides: Record<string, any> = {}) {
  const queries: Array<{
    table: string;
    filters: any[];
    method: string;
    columns?: string;
    orderBy?: { column: string; ascending: boolean };
    limitValue?: number;
  }> = [];

  function from(table: string) {
    const entry = {
      table,
      filters: [] as any[],
      method: "select",
      columns: undefined as string | undefined,
      orderBy: undefined as { column: string; ascending: boolean } | undefined,
      limitValue: undefined as number | undefined,
    };
    queries.push(entry);

    const builder: Record<string, any> = {
      select(columns: string, opts?: any) {
        entry.method = opts?.head ? "count" : "select";
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
      in(col: string, val: unknown[]) {
        entry.filters.push({ col, op: "in", val });
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
      order(column: string, opts?: { ascending?: boolean }) {
        entry.orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(value: number) {
        entry.limitValue = value;
        return builder;
      },
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
      select: {
        data: [{
          id: "m1",
          user_id: "u1",
          status: "active",
          role: "admin",
          created_at: "2026-03-20T12:00:00Z",
          first_name: "Alice",
          last_name: "Jones",
          email: "a@b.com",
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u1", name: "Alice Jones" }],
        error: null,
      },
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
    assert.deepEqual((result.data as any[])[0], {
      id: "m1",
      user_id: "u1",
      status: "active",
      role: "admin",
      created_at: "2026-03-20T12:00:00Z",
      name: "Alice Jones",
      email: "a@b.com",
    });
  }
  const memberQuery = stub.queries.find((q) => q.table === "members");
  assert.ok(memberQuery);
  assert.equal(
    memberQuery.columns,
    "id, user_id, status, role, created_at, first_name, last_name, email"
  );
  assert.ok(memberQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "deleted_at" && f.val === null));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "status" && f.val === "active"));
  assert.deepEqual(memberQuery.orderBy, { column: "created_at", ascending: false });
  assert.equal(memberQuery.limitValue, 20);
  const userQuery = stub.queries.find((q) => q.table === "users");
  assert.ok(userQuery);
  assert.equal(userQuery.columns, "id, name");
  assert.ok(userQuery.filters.some((f: any) => f.col === "id" && f.op === "in" && f.val.includes("u1")));
});

test("list_members trims whitespace when composing a normalized name", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m2",
          user_id: null,
          status: "active",
          role: null,
          created_at: "2026-03-19T12:00:00Z",
          first_name: "Alice",
          last_name: "",
          email: null,
        }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any[])[0].name, "Alice");
  }
});

test("list_members falls back to public.users.name for placeholder member names", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m3",
          user_id: "u3",
          status: "active",
          role: "admin",
          created_at: "2026-03-18T12:00:00Z",
          first_name: "Member",
          last_name: "",
          email: "placeholder@example.com",
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u3", name: "Seann Farrell" }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any[])[0].name, "Seann Farrell");
  }
});

test("list_members falls back to public.users.name for blank member names", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m4",
          user_id: "u4",
          status: "active",
          role: "admin",
          created_at: "2026-03-17T12:00:00Z",
          first_name: "",
          last_name: "",
          email: "blank@example.com",
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u4", name: "Dylan Burak" }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any[])[0].name, "Dylan Burak");
  }
});

test("list_members keeps a valid members name over public.users.name", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m5",
          user_id: "u5",
          status: "active",
          role: "active_member",
          created_at: "2026-03-16T12:00:00Z",
          first_name: "Actual",
          last_name: "Member",
          email: "actual@example.com",
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u5", name: "Directory Override" }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any[])[0].name, "Actual Member");
  }
});

test("list_members returns an empty name when no trustworthy human name exists", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m6",
          user_id: "u6",
          status: "active",
          role: "admin",
          created_at: "2026-03-15T12:00:00Z",
          first_name: "Member",
          last_name: "",
          email: "no-name@example.com",
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u6", name: "no-name@example.com" }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((result.data as any[])[0].name, "");
  }
});

test("list_members with limit", async () => {
  const result = await executeToolCall(ctx, { name: "list_members", args: { limit: 5 } });
  assert.equal(result.ok, true);
  const memberQuery = stub.queries.find((q) => q.table === "members");
  assert.equal(memberQuery?.limitValue, 5);
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
