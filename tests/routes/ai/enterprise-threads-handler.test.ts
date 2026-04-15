/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

const ENTERPRISE_ID = "ent-uuid-1";
const ADMIN_USER = { id: "ent-admin-user", email: "admin@acme.co" };

let entContext: any;
let recordedQueries: Array<{
  table: string;
  filters: Array<{ kind: string; column: string; value: unknown }>;
  orderBy: { column: string; ascending: boolean }[];
  limitValue: number | null;
}> = [];
let threadRows: any[] = [];

function createServiceStub() {
  function from(table: string) {
    const filters: Array<{ kind: string; column: string; value: unknown }> = [];
    const orderBy: { column: string; ascending: boolean }[] = [];
    let limitValue: number | null = null;

    const builder: any = {
      select() { return builder; },
      eq(column: string, value: unknown) {
        filters.push({ kind: "eq", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push({ kind: "is", column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orderBy.push({ column, ascending: opts?.ascending ?? true });
        return builder;
      },
      limit(value: number) {
        limitValue = value;
        return builder;
      },
      then(onF: any, onR?: any) {
        recordedQueries.push({ table, filters: [...filters], orderBy: [...orderBy], limitValue });
        if (table === "ai_threads") {
          let rows = threadRows;
          for (const f of filters) {
            if (f.kind === "eq") rows = rows.filter((r) => r[f.column] === f.value);
            if (f.kind === "is") rows = rows.filter((r) => (r[f.column] ?? null) === f.value);
          }
          if (limitValue !== null) rows = rows.slice(0, limitValue);
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

const { createEnterpriseThreadsGetHandler } = await import(
  "../../../src/app/api/enterprise/[enterpriseId]/ai/threads/handler.ts"
);

let GET = createEnterpriseThreadsGetHandler();

beforeEach(() => {
  recordedQueries = [];
  threadRows = [
    {
      id: "thread-1",
      user_id: ADMIN_USER.id,
      enterprise_id: ENTERPRISE_ID,
      deleted_at: null,
      title: "How many alumni",
      surface: "enterprise",
      created_at: "2026-04-15T10:00:00Z",
      updated_at: "2026-04-15T10:01:00Z",
    },
  ];
  supabase = createServiceStub();

  entContext = {
    ok: true,
    enterpriseId: ENTERPRISE_ID,
    userId: ADMIN_USER.id,
    userEmail: ADMIN_USER.email,
    role: "owner",
    supabase,
    serviceSupabase: supabase,
  };

  GET = createEnterpriseThreadsGetHandler({
    createClient: async () => supabase as any,
    getEnterpriseAiContext: async () => entContext,
  });
});

test("GET enterprise threads returns 401 when context not ok", async () => {
  entContext = {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };

  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });
  assert.equal(response.status, 401);
});

test("GET enterprise threads filters by enterprise_id and user_id", async () => {
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });
  assert.equal(response.status, 200);

  const threadQ = recordedQueries.find((q) => q.table === "ai_threads");
  assert.ok(threadQ, "ai_threads must be queried");
  assert.ok(
    threadQ!.filters.find(
      (f) => f.column === "enterprise_id" && f.value === ENTERPRISE_ID
    ),
    "must filter by enterprise_id"
  );
  assert.ok(
    threadQ!.filters.find((f) => f.column === "user_id" && f.value === ADMIN_USER.id),
    "must filter by user_id"
  );
  assert.ok(
    threadQ!.filters.find((f) => f.column === "deleted_at" && f.value === null),
    "must filter out soft-deleted"
  );
});

test("GET enterprise threads returns thread list", async () => {
  const request = new Request(
    `http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/threads`
  );
  const response = await GET(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });
  const body = await response.json();
  assert.ok(Array.isArray(body.threads));
  assert.equal(body.threads.length, 1);
  assert.equal(body.threads[0].id, "thread-1");
});
