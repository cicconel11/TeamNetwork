/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../../../src/lib/ai/tools/executor.ts";
import { getSuggestionObservabilityByOrg } from "../../../src/lib/falkordb/suggestions.ts";
import { resetFalkorTelemetryForTests } from "../../../src/lib/falkordb/telemetry.ts";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../../../src/lib/ai/tools/executor.ts";
import { StageTimeoutError } from "../../../src/lib/ai/timeout.ts";

const ORG_ID = "org-uuid-1";
const USER_ID = "org-admin-user";
const SOURCE_ALUMNI_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

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
        return Promise.resolve(
          overrides[table]?.maybeSingle ??
            (table === "user_organization_roles"
              ? { data: { role: "admin", status: "active" }, error: null }
              : { data: null, error: null })
        );
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

  const rpc = async (name: string, params: Record<string, unknown> = {}) => {
    const handlers = overrides.rpc ?? {};
    const handler = handlers[name];
    if (!handler) {
      return { data: null, error: { message: `missing rpc ${name}` } };
    }

    if (typeof handler === "function") {
      try {
        return { data: await handler(params), error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { data: null, error: { message } };
      }
    }

    return { data: handler, error: null };
  };

  return { from, rpc, queries };
}

function expectOk(result: ToolExecutionResult): Extract<ToolExecutionResult, { kind: "ok" }> {
  assert.equal(result.kind, "ok");
  return result as Extract<ToolExecutionResult, { kind: "ok" }>;
}

let ctx: ToolExecutionContext;
let stub: ReturnType<typeof createToolSupabaseStub>;

beforeEach(() => {
  resetFalkorTelemetryForTests();
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
      select: {
        data: [{ id: "e1", title: "Spring Gala", start_date: "2026-04-01" }],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };
});

test("list_members returns org-scoped members", async () => {
  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));

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

  const authQuery = stub.queries.find((q) => q.table === "user_organization_roles");
  assert.ok(authQuery);
  assert.ok(authQuery.filters.some((f: any) => f.col === "user_id" && f.val === USER_ID));
  assert.ok(authQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));

  const memberQuery = stub.queries.find((q) => q.table === "members");
  assert.ok(memberQuery);
  assert.equal(memberQuery.columns, "id, user_id, status, role, created_at, first_name, last_name, email");
  assert.ok(memberQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "deleted_at" && f.val === null));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "status" && f.val === "active"));
  assert.deepEqual(memberQuery.orderBy, { column: "created_at", ascending: false });
  assert.equal(memberQuery.limitValue, 20);
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
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));
  assert.equal((result.data as any[])[0].name, "Alice");
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
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));
  assert.equal((result.data as any[])[0].name, "Seann Farrell");
});

test("list_events returns past events", async () => {
  const result = expectOk(
    await executeToolCall(ctx, { name: "list_events", args: { upcoming: false } })
  );
  assert.ok(Array.isArray(result.data));

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
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(await executeToolCall(ctx, { name: "get_org_stats", args: {} }));
  const stats = result.data as any;
  assert.equal(stats.active_members, 42);
  assert.equal(stats.alumni, 10);
  assert.equal(stats.parents, 5);
  assert.equal(stats.upcoming_events, 3);
});

test("suggest_connections returns ranked SQL fallback suggestions", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [
          {
            id: SOURCE_ALUMNI_ID,
            organization_id: ORG_ID,
            user_id: "00000000-0000-4000-8000-000000000001",
            deleted_at: null,
            first_name: "Alex",
            last_name: "Source",
            email: "alex@example.com",
            major: "Computer Science",
            current_company: "Acme",
            industry: "Technology",
            current_city: "Austin",
            graduation_year: 2018,
            position_title: "Engineer",
            job_title: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
            organization_id: ORG_ID,
            user_id: "00000000-0000-4000-8000-000000000002",
            deleted_at: null,
            first_name: "Dina",
            last_name: "Direct",
            email: "dina@example.com",
            major: null,
            current_company: "Acme",
            industry: null,
            current_city: null,
            graduation_year: 2018,
            position_title: "VP Product",
            job_title: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
      maybeSingle: {
        data: {
          id: SOURCE_ALUMNI_ID,
          organization_id: ORG_ID,
          user_id: "00000000-0000-4000-8000-000000000001",
          deleted_at: null,
          first_name: "Alex",
          last_name: "Source",
          email: "alex@example.com",
          major: "Computer Science",
          current_company: "Acme",
          industry: "Technology",
          current_city: "Austin",
          graduation_year: 2018,
          position_title: "Engineer",
          job_title: null,
          created_at: "2026-03-01T00:00:00.000Z",
        },
        error: null,
      },
    },
    rpc: {
      get_mentorship_distances: [
        {
          user_id: "00000000-0000-4000-8000-000000000002",
          distance: 1,
        },
      ],
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_type: "alumni",
        person_id: SOURCE_ALUMNI_ID,
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.mode, "sql_fallback");
  assert.equal(payload.fallback_reason, "disabled");
  assert.equal(payload.freshness.state, "unknown");
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.name, "Alex Source");
  assert.equal(payload.suggestions.length, 1);
  assert.equal(payload.suggestions[0].name, "Dina Direct");
  assert.equal(payload.suggestions[0].score, 128);
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.code),
    ["direct_mentorship", "shared_company", "shared_graduation_year"]
  );
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.label),
    ["direct mentorship", "shared company", "shared graduation year"]
  );

  const telemetry = getSuggestionObservabilityByOrg(ORG_ID);
  assert.equal(telemetry.sqlFallbackCount, 1);
  assert.equal(telemetry.fallbackReasonCounts.disabled, 1);
});

test("suggest_connections resolves a person_query directly", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          {
            id: "member-1",
            organization_id: ORG_ID,
            user_id: "user-1",
            status: "active",
            deleted_at: null,
            first_name: "Louis",
            last_name: "Ciccone",
            email: "louis@example.com",
            role: "Captain",
            current_company: "Acme",
            graduation_year: 2024,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "member-2",
            organization_id: ORG_ID,
            user_id: "user-2",
            status: "active",
            deleted_at: null,
            first_name: "Dana",
            last_name: "Coach",
            email: "dana@example.com",
            role: "Coach",
            current_company: "Acme",
            graduation_year: 2024,
            created_at: "2026-03-02T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [],
        error: null,
      },
    },
    rpc: {
      get_mentorship_distances: [
        {
          user_id: "user-2",
          distance: 1,
        },
      ],
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.name, "Louis Ciccone");
  assert.equal(payload.suggestions[0].name, "Dana Coach");
});

test("suggest_connections returns ambiguous state for matching person_query", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          {
            id: "member-1",
            organization_id: ORG_ID,
            user_id: null,
            status: "active",
            deleted_at: null,
            first_name: "Louis",
            last_name: "Ciccone",
            email: "louis.one@example.com",
            role: "Captain",
            current_company: null,
            graduation_year: 2024,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "member-2",
            organization_id: ORG_ID,
            user_id: null,
            status: "active",
            deleted_at: null,
            first_name: "Louis",
            last_name: "Ciccone",
            email: "louis.two@example.com",
            role: "Manager",
            current_company: null,
            graduation_year: 2025,
            created_at: "2026-03-02T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [],
        error: null,
      },
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "ambiguous");
  assert.equal(payload.suggestions.length, 0);
  assert.equal(payload.disambiguation_options.length, 2);
});

test("suggest_connections returns not_found for unknown person_query", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: { data: [], error: null },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Ghost Person",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "not_found");
  assert.equal(payload.suggestions.length, 0);
});

test("suggest_connections returns no_suggestions when the source has no supported matches", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          {
            id: "member-1",
            organization_id: ORG_ID,
            user_id: "user-1",
            status: "active",
            deleted_at: null,
            first_name: "Louis",
            last_name: "Ciccone",
            email: "louis@example.com",
            role: "Captain",
            current_company: null,
            graduation_year: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "member-2",
            organization_id: ORG_ID,
            user_id: "user-2",
            status: "active",
            deleted_at: null,
            first_name: "Dana",
            last_name: "Coach",
            email: "dana@example.com",
            role: "Coach",
            current_company: null,
            graduation_year: null,
            created_at: "2026-03-02T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
    rpc: {
      get_mentorship_distances: [],
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "no_suggestions");
  assert.equal(payload.source_person.name, "Louis Ciccone");
  assert.equal(payload.suggestions.length, 0);
});

test("invalid args return tool_error", async () => {
  const result = await executeToolCall(ctx, {
    name: "list_members",
    args: { limit: 999 } as any,
  });

  assert.equal(result.kind, "tool_error");
  assert.match(result.error, /invalid/i);
});

test("db errors return tool_error", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: null, error: { message: "connection refused" } } },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.equal(result.kind, "tool_error");
});

test("missing membership returns forbidden before touching tool tables", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: { maybeSingle: { data: null, error: null } },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
  assert.equal(stub.queries.some((q) => q.table === "members"), false);
});

test("pending or revoked membership returns forbidden", async () => {
  for (const status of ["pending", "revoked"]) {
    stub = createToolSupabaseStub({
      user_organization_roles: {
        maybeSingle: { data: { role: "admin", status }, error: null },
      },
    });
    ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

    const result = await executeToolCall(ctx, { name: "list_members", args: {} });
    assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
  }
});

test("non-admin membership returns forbidden", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: {
      maybeSingle: { data: { role: "active_member", status: "active" }, error: null },
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
});

test("membership query failure returns auth_error", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: {
      maybeSingle: { data: null, error: { message: "db unavailable" } },
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "auth_error", error: "Auth check failed" });
});

test("stage timeout returns timeout result", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: Promise.reject(new StageTimeoutError("tool_list_members", 5_000)),
    },
  });
  ctx = { orgId: ORG_ID, userId: USER_ID, serviceSupabase: stub as any };

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "timeout", error: "Tool timed out" });
});

test("unknown tool name returns tool_error", async () => {
  const result = await executeToolCall(ctx, { name: "hack_the_planet" as any, args: {} });
  assert.equal(result.kind, "tool_error");
  assert.match(result.error, /unknown/i);
});
