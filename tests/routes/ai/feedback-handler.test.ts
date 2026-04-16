/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

const ORG_A_ID = "00000000-0000-4000-a000-000000000001";
const ORG_B_ID = "00000000-0000-4000-a000-000000000002";
const ADMIN_USER = {
  id: "00000000-0000-4000-a000-000000000099",
  email: "admin@example.com",
};
const THREAD_A_ID = "10000000-0000-4000-a000-000000000001";
const THREAD_B_ID = "10000000-0000-4000-a000-000000000002";
const MESSAGE_A_ID = "20000000-0000-4000-a000-000000000001";
const MESSAGE_B_ID = "20000000-0000-4000-a000-000000000002";
const FEEDBACK_A_ID = "30000000-0000-4000-a000-000000000001";

const {
  createAiFeedbackDeleteHandler,
  createAiFeedbackGetHandler,
} = await import("../../../src/app/api/ai/[orgId]/feedback/handler.ts");

type StubState = {
  threads: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  feedback: Array<Record<string, unknown>>;
};

function createSupabaseStub() {
  const state: StubState = {
    threads: [
      {
        id: THREAD_A_ID,
        user_id: ADMIN_USER.id,
        org_id: ORG_A_ID,
      },
      {
        id: THREAD_B_ID,
        user_id: ADMIN_USER.id,
        org_id: ORG_B_ID,
      },
    ],
    messages: [
      {
        id: MESSAGE_A_ID,
        thread_id: THREAD_A_ID,
      },
      {
        id: MESSAGE_B_ID,
        thread_id: THREAD_B_ID,
      },
    ],
    feedback: [
      {
        id: FEEDBACK_A_ID,
        message_id: MESSAGE_A_ID,
        user_id: ADMIN_USER.id,
        rating: "positive",
        comment: null,
        created_at: "2026-04-15T12:00:00Z",
      },
    ],
  };

  function applyFilters(
    rows: Array<Record<string, unknown>>,
    query: {
      eqFilters: Array<{ column: string; value: unknown }>;
      inFilters: Array<{ column: string; values: unknown[] }>;
    }
  ) {
    return rows.filter((row) => {
      for (const filter of query.eqFilters) {
        if (row[filter.column] !== filter.value) return false;
      }
      for (const filter of query.inFilters) {
        if (!filter.values.includes(row[filter.column])) return false;
      }
      return true;
    });
  }

  function from(table: string) {
    const query = {
      mode: "select" as "select" | "delete",
      eqFilters: [] as Array<{ column: string; value: unknown }>,
      inFilters: [] as Array<{ column: string; values: unknown[] }>,
    };

    const builder: Record<string, any> = {
      select(columns: string) {
        void columns;
        return builder;
      },
      delete() {
        query.mode = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        query.eqFilters.push({ column, value });
        return builder;
      },
      in(column: string, values: unknown[]) {
        query.inFilters.push({ column, values });
        return builder;
      },
      single() {
        const result = resolve();
        const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return Promise.resolve({ data: row, error: result.error });
      },
      maybeSingle() {
        const result = resolve();
        const row = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return Promise.resolve({ data: row, error: result.error });
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };

    function resolve() {
      if (table === "ai_messages") {
        return { data: applyFilters(state.messages, query), error: null };
      }

      if (table === "ai_threads") {
        return { data: applyFilters(state.threads, query), error: null };
      }

      if (table === "ai_feedback" && query.mode === "select") {
        return { data: applyFilters(state.feedback, query), error: null };
      }

      if (table === "ai_feedback" && query.mode === "delete") {
        const retained = state.feedback.filter((row) => !applyFilters([row], query).length);
        state.feedback = retained;
        return { data: null, error: null };
      }

      return { data: null, error: null };
    }

    return builder;
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: ADMIN_USER } }),
    },
    from,
    state,
  };
}

let supabaseStub = createSupabaseStub();

function buildAiContext(orgId: string) {
  return {
    ok: true,
    orgId,
    userId: ADMIN_USER.id,
    role: "admin",
    supabase: supabaseStub,
    serviceSupabase: {},
  };
}

beforeEach(() => {
  (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore?.clear();
  supabaseStub = createSupabaseStub();
});

test("GET /api/ai/[orgId]/feedback returns the saved rating for an owned message in the current org", async () => {
  const handler = createAiFeedbackGetHandler({
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => buildAiContext(ORG_A_ID) as any,
  });

  const response = await handler(
    new Request(
      `http://localhost/api/ai/${ORG_A_ID}/feedback?messageId=${encodeURIComponent(MESSAGE_A_ID)}`
    ) as any,
    { params: Promise.resolve({ orgId: ORG_A_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data?.message_id, MESSAGE_A_ID);
  assert.equal(body.data?.rating, "positive");
});

test("GET /api/ai/[orgId]/feedback rejects messages from a different org even for the same user", async () => {
  const handler = createAiFeedbackGetHandler({
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => buildAiContext(ORG_A_ID) as any,
  });

  const response = await handler(
    new Request(
      `http://localhost/api/ai/${ORG_A_ID}/feedback?messageId=${encodeURIComponent(MESSAGE_B_ID)}`
    ) as any,
    { params: Promise.resolve({ orgId: ORG_A_ID }) }
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.deepEqual(body, {
    error: "Thread does not belong to this organization",
  });
});

test("DELETE /api/ai/[orgId]/feedback removes persisted feedback for the current user", async () => {
  const handler = createAiFeedbackDeleteHandler({
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => buildAiContext(ORG_A_ID) as any,
  });

  const response = await handler(
    new Request(
      `http://localhost/api/ai/${ORG_A_ID}/feedback?messageId=${encodeURIComponent(MESSAGE_A_ID)}`,
      { method: "DELETE" }
    ) as any,
    { params: Promise.resolve({ orgId: ORG_A_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { success: true });
  assert.equal(supabaseStub.state.feedback.length, 0);
});
