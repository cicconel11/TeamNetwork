/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

const ORG_ID = "org-uuid-1";
const ADMIN_USER = { id: "admin-user", email: "admin@example.com" };
const THREAD_1_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_2_ID = "22222222-2222-4222-8222-222222222222";

let authUser: { id: string; email: string } | null = ADMIN_USER;
let aiContext: any;
let threadResolution: any;

function createSupabaseStub() {
  const state = {
    threads: [
      {
        id: THREAD_1_ID,
        user_id: ADMIN_USER.id,
        org_id: ORG_ID,
        surface: "general",
        title: "First thread",
        created_at: "2024-01-01T10:00:00Z",
        updated_at: "2024-01-05T10:00:00Z",
        deleted_at: null,
      },
      {
        id: THREAD_2_ID,
        user_id: ADMIN_USER.id,
        org_id: ORG_ID,
        surface: "members",
        title: "Second thread",
        created_at: "2024-01-03T10:00:00Z",
        updated_at: "2024-01-04T10:00:00Z",
        deleted_at: null,
      },
    ] as Array<Record<string, unknown>>,
    messages: [
      {
        id: "msg-1",
        thread_id: THREAD_1_ID,
        role: "user",
        content: "Hello",
        intent: null,
        context_surface: "general",
        status: "complete",
        created_at: "2024-01-01T10:00:00Z",
      },
      {
        id: "msg-2",
        thread_id: THREAD_1_ID,
        role: "assistant",
        content: "[abandoned]",
        intent: "greeting",
        context_surface: "members",
        status: "error",
        created_at: "2024-01-01T10:00:05Z",
      },
    ] as Array<Record<string, unknown>>,
  };

  function from(table: string) {
    const query = {
      op: "select" as "select" | "update",
      filters: [] as Array<{ kind: "eq" | "lt"; column: string; value: unknown }>,
      orderBy: [] as Array<{ column: string; ascending: boolean }>,
      limitValue: null as number | null,
      updated: null as Record<string, unknown> | null,
    };

    const builder: Record<string, any> = {
      select(columns: string) {
        void columns;
        return builder;
      },
      update(payload: Record<string, unknown>) {
        query.op = "update";
        query.updated = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ kind: "eq", column, value });
        return builder;
      },
      lt(column: string, value: unknown) {
        query.filters.push({ kind: "lt", column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        query.orderBy.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      or(filter: string) {
        const updatedAtLt = filter.match(/updated_at\.lt\.([^,]+)/)?.[1] ?? null;
        const updatedAtEq = filter.match(/updated_at\.eq\.([^,]+)/)?.[1] ?? null;
        const idLt = filter.match(/id\.lt\.([^)]+)/)?.[1] ?? null;

        if (updatedAtLt && updatedAtEq && idLt) {
          query.filters.push({
            kind: "lt",
            column: "__updated_at_cursor__",
            value: { updatedAtLt, updatedAtEq, idLt },
          });
        }
        return builder;
      },
      limit(value: number) {
        query.limitValue = value;
        return builder;
      },
    };

    const resolve = () => {
      if (table === "ai_threads" && query.op === "select") {
        let rows = [...state.threads];
        for (const filter of query.filters) {
          if (filter.kind === "eq") {
            rows = rows.filter((row) => row[filter.column] === filter.value);
          }
          if (filter.kind === "lt") {
            if (filter.column === "__updated_at_cursor__") {
              const cursor = filter.value as {
                updatedAtLt: string;
                updatedAtEq: string;
                idLt: string;
              };
              rows = rows.filter((row) => {
                const updatedAt = String(row.updated_at ?? "");
                const id = String(row.id ?? "");
                return (
                  updatedAt < cursor.updatedAtLt ||
                  (updatedAt === cursor.updatedAtEq && id < cursor.idLt)
                );
              });
            } else {
              rows = rows.filter((row) => String(row[filter.column] ?? "") < String(filter.value));
            }
          }
        }
        if (query.orderBy.length > 0) {
          rows.sort((a, b) => {
            for (const order of query.orderBy) {
              const aValue = String(a[order.column] ?? "");
              const bValue = String(b[order.column] ?? "");
              const comparison = order.ascending
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
              if (comparison !== 0) {
                return comparison;
              }
            }
            return 0;
          });
        }
        if (query.limitValue !== null) {
          rows = rows.slice(0, query.limitValue);
        }
        return { data: rows, error: null };
      }

      if (table === "ai_threads" && query.op === "update" && query.updated) {
        for (const row of state.threads) {
          const matches = query.filters.every(
            (filter) => filter.kind !== "eq" || row[filter.column] === filter.value
          );
          if (matches) {
            Object.assign(row, query.updated);
          }
        }
        return { data: null, error: null };
      }

      if (table === "ai_messages") {
        let rows = [...state.messages];
        for (const filter of query.filters) {
          if (filter.kind === "eq") {
            rows = rows.filter((row) => row[filter.column] === filter.value);
          }
        }
        if (query.orderBy) {
          rows.sort((a, b) => {
            const aValue = String(a[query.orderBy!.column] ?? "");
            const bValue = String(b[query.orderBy!.column] ?? "");
            return query.orderBy!.ascending
              ? aValue.localeCompare(bValue)
              : bValue.localeCompare(aValue);
          });
        }
        return { data: rows, error: null };
      }

      return { data: null, error: null };
    };

    builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return builder;
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: authUser } }),
    },
    from,
    state,
  };
}

let supabaseStub = createSupabaseStub();

const { createAiThreadsGetHandler } = await import("../../../src/app/api/ai/[orgId]/threads/handler.ts");
const { createAiThreadMessagesGetHandler } = await import(
  "../../../src/app/api/ai/[orgId]/threads/[threadId]/messages/handler.ts"
);
const { createAiThreadDeleteHandler } = await import(
  "../../../src/app/api/ai/[orgId]/threads/[threadId]/handler.ts"
);

const GET_THREADS = createAiThreadsGetHandler({
  createClient: async () => supabaseStub as any,
  getAiOrgContext: async () => aiContext,
});
const GET_MESSAGES = createAiThreadMessagesGetHandler({
  createClient: async () => supabaseStub as any,
  getAiOrgContext: async () => aiContext,
  resolveOwnThread: async () => threadResolution,
});
const DELETE_THREAD = createAiThreadDeleteHandler({
  createClient: async () => supabaseStub as any,
  getAiOrgContext: async () => aiContext,
  resolveOwnThread: async () => threadResolution,
});

beforeEach(() => {
  authUser = ADMIN_USER;
  supabaseStub = createSupabaseStub();
  aiContext = {
    ok: true,
    orgId: ORG_ID,
    userId: ADMIN_USER.id,
    role: "admin",
    supabase: supabaseStub,
    serviceSupabase: {},
  };
  threadResolution = {
    ok: true,
    thread: {
      id: THREAD_1_ID,
      user_id: ADMIN_USER.id,
      org_id: ORG_ID,
      surface: "general",
      title: "First thread",
    },
  };
});

test("GET /api/ai/[orgId]/threads returns thread data for authorized admins", async () => {
  const response = await GET_THREADS(
    new Request(`http://localhost/api/ai/${ORG_ID}/threads`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].id, THREAD_1_ID);
});

test("GET /api/ai/[orgId]/threads paginates by updated_at activity cursor", async () => {
  const firstPageResponse = await GET_THREADS(
    new Request(`http://localhost/api/ai/${ORG_ID}/threads?limit=1`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(firstPageResponse.status, 200);
  const firstPage = await firstPageResponse.json();
  assert.equal(firstPage.data.length, 1);
  assert.equal(firstPage.data[0].id, THREAD_1_ID);
  assert.equal(typeof firstPage.nextCursor, "string");
  assert.equal(firstPage.hasMore, true);

  const secondPageResponse = await GET_THREADS(
    new Request(
      `http://localhost/api/ai/${ORG_ID}/threads?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`
    ) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(secondPageResponse.status, 200);
  const secondPage = await secondPageResponse.json();
  assert.equal(secondPage.data.length, 1);
  assert.equal(secondPage.data[0].id, THREAD_2_ID);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(secondPage.hasMore, false);
});

test("GET /api/ai/[orgId]/threads returns 403 for unauthorized org access", async () => {
  aiContext = {
    ok: false,
    response: NextResponse.json(
      { error: "AI assistant requires admin role" },
      { status: 403 }
    ),
  };

  const response = await GET_THREADS(
    new Request(`http://localhost/api/ai/${ORG_ID}/threads`) as any,
    { params: Promise.resolve({ orgId: ORG_ID }) }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.deepEqual(body, { error: "AI assistant requires admin role" });
});

test("GET /api/ai/[orgId]/threads/[threadId]/messages returns ordered messages", async () => {
  const response = await GET_MESSAGES(
    new Request(`http://localhost/api/ai/${ORG_ID}/threads/${THREAD_1_ID}/messages`) as any,
    { params: Promise.resolve({ orgId: ORG_ID, threadId: THREAD_1_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].id, "msg-1");
  assert.equal(body.messages[0].context_surface, "general");
  assert.equal(body.messages[1].id, "msg-2");
  assert.equal(body.messages[1].context_surface, "members");
  assert.equal(
    body.messages[1].content,
    "This response was interrupted. You can retry when you're ready."
  );
  assert.equal(body.messages[1].status, "interrupted");
});

test("DELETE /api/ai/[orgId]/threads/[threadId] soft-deletes an owned thread", async () => {
  const response = await DELETE_THREAD(
    new Request(`http://localhost/api/ai/${ORG_ID}/threads/${THREAD_1_ID}`, {
      method: "DELETE",
    }) as any,
    { params: Promise.resolve({ orgId: ORG_ID, threadId: THREAD_1_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { success: true });
  assert.ok(supabaseStub.state.threads[0].deleted_at);
});
