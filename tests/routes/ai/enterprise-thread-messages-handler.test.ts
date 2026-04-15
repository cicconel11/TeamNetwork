/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

const ENTERPRISE_ID = "ent-uuid-1";
const THREAD_ID = "thread-1";
const ADMIN_USER = { id: "ent-admin-user", email: "admin@acme.co" };

let entContext: any;
let recordedQueries: Array<{
  table: string;
  op: string;
  filters: Array<{ kind: string; column: string; value: unknown }>;
  updated?: any;
}> = [];
let messageRows: any[] = [];
let resolveResult: any;

function createServiceStub() {
  function from(table: string) {
    const filters: Array<{ kind: string; column: string; value: unknown }> = [];
    let op: "select" | "update" = "select";
    let updated: any = null;

    const builder: any = {
      select() { return builder; },
      update(payload: any) {
        op = "update";
        updated = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push({ kind: "eq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push({ kind: "is", column, value });
        return builder;
      },
      order() { return builder; },
      limit() { return builder; },
      then(onF: any, onR?: any) {
        recordedQueries.push({ table, op, filters: [...filters], updated });
        if (table === "ai_messages" && op === "select") {
          let rows = messageRows;
          for (const f of filters) {
            if (f.kind === "eq") rows = rows.filter((r) => r[f.column] === f.value);
          }
          return Promise.resolve({ data: rows, error: null }).then(onF, onR);
        }
        return Promise.resolve({ data: null, error: null }).then(onF, onR);
      },
    };
    return builder;
  }

  return {
    auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
    from,
  };
}

let supabase = createServiceStub();

const { createEnterpriseThreadMessagesGetHandler } = await import(
  "../../../src/app/api/enterprise/[enterpriseId]/ai/threads/[threadId]/messages/handler.ts"
);
const { createEnterpriseThreadDeleteHandler } = await import(
  "../../../src/app/api/enterprise/[enterpriseId]/ai/threads/[threadId]/handler.ts"
);

let GET = createEnterpriseThreadMessagesGetHandler();
let DELETE = createEnterpriseThreadDeleteHandler();

beforeEach(() => {
  recordedQueries = [];
  messageRows = [
    { id: "m1", thread_id: THREAD_ID, role: "user", content: "How many alumni?", status: "complete", created_at: "2026-04-15T10:00:00Z" },
    { id: "m2", thread_id: THREAD_ID, role: "assistant", content: "42", status: "complete", created_at: "2026-04-15T10:00:01Z" },
  ];
  supabase = createServiceStub();
  resolveResult = {
    ok: true,
    thread: {
      id: THREAD_ID,
      user_id: ADMIN_USER.id,
      org_id: null,
      enterprise_id: ENTERPRISE_ID,
      surface: "enterprise",
      title: "Thread",
    },
  };

  entContext = {
    ok: true,
    enterpriseId: ENTERPRISE_ID,
    userId: ADMIN_USER.id,
    userEmail: ADMIN_USER.email,
    role: "owner",
    supabase,
    serviceSupabase: supabase,
  };

  GET = createEnterpriseThreadMessagesGetHandler({
    createClient: async () => supabase as any,
    getEnterpriseAiContext: async () => entContext,
    resolveOwnThread: async () => resolveResult,
  });

  DELETE = createEnterpriseThreadDeleteHandler({
    createClient: async () => supabase as any,
    getEnterpriseAiContext: async () => entContext,
    resolveOwnThread: async () => resolveResult,
  });
});

test("GET enterprise thread messages returns 403 when context fails", async () => {
  entContext = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads/${THREAD_ID}/messages`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID, threadId: THREAD_ID }),
  });
  assert.equal(response.status, 403);
});

test("GET enterprise thread messages returns 404 when thread not owned by enterprise", async () => {
  resolveResult = { ok: false, status: 404, message: "Thread not found" };
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads/${THREAD_ID}/messages`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID, threadId: THREAD_ID }),
  });
  assert.equal(response.status, 404);
});

test("GET enterprise thread messages returns messages filtered by thread_id", async () => {
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads/${THREAD_ID}/messages`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID, threadId: THREAD_ID }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "user");
});

test("DELETE enterprise thread soft-deletes via auth-bound supabase", async () => {
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads/${THREAD_ID}`,
    { method: "DELETE" }
  );
  const response = await DELETE(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID, threadId: THREAD_ID }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);

  const updateQ = recordedQueries.find(
    (q) => q.table === "ai_threads" && q.op === "update"
  );
  assert.ok(updateQ, "must issue an update on ai_threads");
  assert.ok(updateQ!.updated.deleted_at, "must set deleted_at");
  assert.ok(
    updateQ!.filters.find((f) => f.column === "id" && f.value === THREAD_ID),
    "must filter by thread id"
  );
});
