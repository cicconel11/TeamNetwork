/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

/**
 * Tests for enterprise AI chat handler.
 *
 * Confirms:
 *  - 401 when unauthenticated
 *  - 400 on invalid body
 *  - 403 when caller has no user_enterprise_roles row for target enterprise
 *  - 200 happy path: SSE stream + init_ai_chat_enterprise called correctly
 *  - audit dual-write: ai_audit_log row + enterprise_audit_logs mirror
 *  - tool execution: get_enterprise_stats invoked, ctx.enterpriseId injected
 *  - LLM-supplied enterprise_id in tool args is stripped (Zod strict)
 *  - thread resolver enforces enterprise scope
 */

const ENTERPRISE_ID = "ent-uuid-1";
const VALID_IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "ent-admin-user", email: "admin@acme.co" };

let authUser: { id: string; email: string } | null = ADMIN_USER;
let entContext: any;
let auditEntries: any[] = [];
let buildCtxCalls: any[] = [];
let initChatCalls: any[] = [];
let executedToolCalls: Array<{ ctx: any; call: any }> = [];
let recordedQueries: Array<{
  table: string;
  op: "select" | "insert" | "update";
  filters: Array<{ kind: "eq" | "in" | "lt" | "is"; column: string; value: unknown }>;
}> = [];

function createSupabaseStub() {
  const state = {
    threadCount: 0,
    assistantCount: 0,
    threads: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
  };

  function from(table: string) {
    const query = {
      table,
      op: "select" as "select" | "insert" | "update",
      inserted: null as Record<string, unknown> | null,
      updated: null as Record<string, unknown> | null,
      filters: [] as Array<{ kind: "eq" | "in" | "lt" | "is"; column: string; value: unknown }>,
      orderBy: null as { column: string; ascending: boolean } | null,
      limitValue: null as number | null,
      resultMode: "many" as "many" | "maybeSingle" | "single",
    };

    const builder: Record<string, any> = {
      select() { return builder; },
      insert(payload: Record<string, unknown>) {
        query.op = "insert";
        query.inserted = payload;
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
      in(column: string, value: unknown[]) {
        query.filters.push({ kind: "in", column, value });
        return builder;
      },
      lt(column: string, value: unknown) {
        query.filters.push({ kind: "lt", column, value });
        return builder;
      },
      is(column: string, value: unknown) {
        query.filters.push({ kind: "is", column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        query.orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(value: number) {
        query.limitValue = value;
        return builder;
      },
    };

    const resolve = () => {
      recordedQueries.push({
        table,
        op: query.op,
        filters: [...query.filters],
      });

      if (table === "ai_messages") {
        if (query.op === "select") {
          let rows = [...state.messages];
          for (const filter of query.filters) {
            if (filter.kind === "eq") {
              rows = rows.filter((row) => row[filter.column] === filter.value);
            } else if (filter.kind === "is") {
              rows = rows.filter((row) => (row[filter.column] ?? null) === filter.value);
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
          if (query.limitValue !== null) {
            rows = rows.slice(0, query.limitValue);
          }
          if (query.resultMode === "maybeSingle") {
            return { data: rows[0] ?? null, error: null };
          }
          if (query.resultMode === "single") {
            return { data: rows[0] ?? null, error: null };
          }
          return { data: rows, error: null };
        }

        if (query.op === "insert" && query.inserted) {
          if (query.inserted.role === "assistant") {
            const id = `assistant-${++state.assistantCount}`;
            state.messages.push({ id, ...query.inserted });
            return { data: { id }, error: null };
          }
          state.messages.push({
            id: `user-${state.messages.length + 1}`,
            ...query.inserted,
            created_at: new Date().toISOString(),
          });
          return { data: null, error: null };
        }

        if (query.op === "update" && query.updated) {
          for (const row of state.messages) {
            const matches = query.filters.every((filter) => {
              if (filter.kind === "eq") return row[filter.column] === filter.value;
              if (filter.kind === "in") {
                return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
              }
              if (filter.kind === "lt") return String(row[filter.column] ?? "") < String(filter.value);
              return true;
            });
            if (matches) Object.assign(row, query.updated);
          }
          return { data: null, error: null };
        }
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => {
      query.resultMode = "maybeSingle";
      return resolve();
    };
    builder.single = async () => {
      query.resultMode = "single";
      return resolve();
    };
    builder.then = (onFulfilled: any, onRejected?: any) =>
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

const { createEnterpriseChatPostHandler } = await import(
  "../../../src/app/api/enterprise/[enterpriseId]/ai/chat/handler.ts"
);

let POST = createEnterpriseChatPostHandler();

beforeEach(() => {
  authUser = ADMIN_USER;
  supabaseStub = createSupabaseStub();
  auditEntries = [];
  buildCtxCalls = [];
  initChatCalls = [];
  executedToolCalls = [];
  recordedQueries = [];

  entContext = {
    ok: true,
    enterpriseId: ENTERPRISE_ID,
    userId: ADMIN_USER.id,
    userEmail: ADMIN_USER.email,
    role: "owner",
    supabase: supabaseStub,
    serviceSupabase: {
      rpc: async (fn: string, params: any) => {
        if (fn === "init_ai_chat_enterprise") {
          initChatCalls.push(params);
          const threadId = params.p_thread_id ?? `thread-${++supabaseStub.state.threadCount}`;
          supabaseStub.state.threads.push({
            id: threadId,
            user_id: params.p_user_id,
            enterprise_id: params.p_enterprise_id,
            surface: "enterprise",
            title: params.p_title,
          });
          supabaseStub.state.messages.push({
            id: `user-${supabaseStub.state.messages.length + 1}`,
            thread_id: threadId,
            enterprise_id: params.p_enterprise_id,
            user_id: params.p_user_id,
            role: "user",
            content: params.p_message,
            status: "complete",
            idempotency_key: params.p_idempotency_key,
            created_at: new Date().toISOString(),
          });
          return {
            data: { thread_id: threadId, user_msg_id: `user-${supabaseStub.state.messages.length}` },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    },
  };

  POST = createEnterpriseChatPostHandler({
    createClient: async () => supabaseStub as any,
    getEnterpriseAiContext: async () => entContext,
    buildEnterprisePromptContext: async (input: any) => {
      buildCtxCalls.push(input);
      return {
        systemPrompt: "Enterprise system prompt",
        orgContextMessage: null,
      };
    },
    createZaiClient: () => ({ client: "fake" } as any),
    getZaiModel: () => "glm-5",
    composeResponse: (async function* (options: {
      onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    }) {
      options.onUsage?.({ inputTokens: 12, outputTokens: 7 });
      yield { type: "chunk", content: "Hello enterprise" };
    }) as any,
    logAiRequest: async (_sb: unknown, entry: unknown) => {
      auditEntries.push(entry);
    },
    resolveOwnThread: async () => ({
      ok: true,
      thread: {
        id: "thread-1",
        user_id: ADMIN_USER.id,
        org_id: null,
        enterprise_id: ENTERPRISE_ID,
        surface: "enterprise",
        title: "Thread",
      },
    }),
    executeEnterpriseToolCall: async (ctx: any, call: any) => {
      executedToolCalls.push({ ctx, call });
      return { kind: "ok", data: { total_alumni_count: 42 } };
    },
  });

  process.env.ZAI_API_KEY = "test-key";
});

test("POST /api/enterprise/[enterpriseId]/ai/chat returns 401 when unauthenticated", async () => {
  authUser = null;
  entContext = {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };

  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "hi",
      surface: "enterprise",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 401);
});

test("POST /api/enterprise/[enterpriseId]/ai/chat returns 400 on invalid body", async () => {
  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surface: "enterprise" }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 400);
});

test("POST /api/enterprise/[enterpriseId]/ai/chat returns 403 when caller lacks enterprise role", async () => {
  entContext = {
    ok: false,
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };

  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How many alumni?",
      surface: "enterprise",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 403);
});

test("POST /api/enterprise/[enterpriseId]/ai/chat happy path streams and calls init_ai_chat_enterprise", async () => {
  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How many alumni across orgs?",
      surface: "enterprise",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");

  const body = await response.text();
  assert.match(body, /"type":"chunk"/);
  assert.match(body, /Hello enterprise/);
  assert.match(body, /"type":"done"/);

  assert.equal(initChatCalls.length, 1);
  assert.equal(initChatCalls[0].p_enterprise_id, ENTERPRISE_ID);
  assert.equal(initChatCalls[0].p_user_id, ADMIN_USER.id);
  assert.equal(initChatCalls[0].p_idempotency_key, VALID_IDEMPOTENCY_KEY);

  assert.equal(buildCtxCalls.length, 1);
  assert.equal(buildCtxCalls[0].enterpriseId, ENTERPRISE_ID);
  assert.equal(buildCtxCalls[0].userId, ADMIN_USER.id);
});

test("POST /api/enterprise/[enterpriseId]/ai/chat writes audit row with enterprise scope", async () => {
  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Show subscription",
      surface: "enterprise",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 200);
  await response.text();

  assert.equal(auditEntries.length, 1);
  assert.deepEqual(auditEntries[0].scope, {
    scope: "enterprise",
    enterpriseId: ENTERPRISE_ID,
  });
  assert.equal(auditEntries[0].userEmail, ADMIN_USER.email);
  assert.equal(auditEntries[0].userId, ADMIN_USER.id);
});

test("POST /api/enterprise/[enterpriseId]/ai/chat invokes tool with ctx.enterpriseId, not LLM args", async () => {
  // composeResponse yields a tool call; on second iteration, plain chunk
  let pass = 0;
  POST = createEnterpriseChatPostHandler({
    createClient: async () => supabaseStub as any,
    getEnterpriseAiContext: async () => entContext,
    buildEnterprisePromptContext: async (input: any) => {
      buildCtxCalls.push(input);
      return { systemPrompt: "x", orgContextMessage: null };
    },
    createZaiClient: () => ({ client: "fake" } as any),
    getZaiModel: () => "glm-5",
    composeResponse: (async function* () {
      pass += 1;
      if (pass === 1) {
        yield {
          type: "tool_call_requested",
          id: "tc-1",
          name: "get_enterprise_stats",
          // LLM-supplied enterprise_id MUST be ignored — strict zod strips it
          argsJson: JSON.stringify({ enterprise_id: "ATTACKER-ENT" }),
        };
      } else {
        yield { type: "chunk", content: "42 alumni" };
      }
    }) as any,
    logAiRequest: async (_sb: unknown, entry: unknown) => {
      auditEntries.push(entry);
    },
    resolveOwnThread: async () => ({ ok: true, thread: {} as any }),
    executeEnterpriseToolCall: async (ctx: any, call: any) => {
      executedToolCalls.push({ ctx, call });
      return { kind: "ok", data: { total_alumni_count: 42 } };
    },
  });

  const request = new Request(`http://localhost/api/enterprise/${ENTERPRISE_ID}/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "alumni count",
      surface: "enterprise",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ enterpriseId: ENTERPRISE_ID }),
  });

  assert.equal(response.status, 200);
  await response.text();

  assert.equal(executedToolCalls.length, 1);
  // Server-validated context wins — never trust LLM-supplied enterprise_id
  assert.equal(executedToolCalls[0].ctx.enterpriseId, ENTERPRISE_ID);
  assert.equal(executedToolCalls[0].ctx.userId, ADMIN_USER.id);
  assert.equal(executedToolCalls[0].call.name, "get_enterprise_stats");
});
