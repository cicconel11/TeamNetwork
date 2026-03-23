/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

const ORG_ID = "org-uuid-1";
const VALID_IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "org-admin-user", email: "admin@example.com" };

let authUser: { id: string; email: string } | null = ADMIN_USER;
let aiContext: any;
let auditEntries: any[] = [];
let buildPromptContextCalls: any[] = [];
let initChatCalls: any[] = [];
let retrieveRelevantChunksCalls: any[] = [];

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
      filters: [] as Array<{ kind: "eq" | "in" | "lt"; column: string; value: unknown }>,
      orderBy: null as { column: string; ascending: boolean } | null,
      limitValue: null as number | null,
    };

    const builder: Record<string, any> = {
      select(columns: string) {
        void columns;
        return builder;
      },
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
      if (table === "ai_threads" && query.op === "insert" && query.inserted) {
        const id = `thread-${++state.threadCount}`;
        state.threads.push({ id, ...query.inserted });
        return { data: { id }, error: null };
      }

      if (table === "ai_messages") {
        if (
          query.op === "select" &&
          query.filters.some((filter) => filter.kind === "eq" && filter.column === "idempotency_key")
        ) {
          return { data: null, error: null };
        }

        if (query.op === "select") {
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
          if (query.limitValue !== null) {
            rows = rows.slice(0, query.limitValue);
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
              if (filter.kind === "eq") {
                return row[filter.column] === filter.value;
              }
              if (filter.kind === "in") {
                return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
              }
              if (filter.kind === "lt") {
                return String(row[filter.column] ?? "") < String(filter.value);
              }
              return true;
            });
            if (matches) {
              Object.assign(row, query.updated);
            }
          }
          return { data: null, error: null };
        }
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => resolve();
    builder.single = async () => resolve();
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

const { createChatPostHandler } = await import("../../../src/app/api/ai/[orgId]/chat/handler.ts");
let POST = createChatPostHandler();

beforeEach(() => {
  authUser = ADMIN_USER;
  supabaseStub = createSupabaseStub();
  auditEntries = [];
  buildPromptContextCalls = [];
  initChatCalls = [];
  retrieveRelevantChunksCalls = [];
  aiContext = {
    ok: true,
    orgId: ORG_ID,
    userId: ADMIN_USER.id,
    userEmail: ADMIN_USER.email,
    role: "admin",
    supabase: supabaseStub,
    serviceSupabase: {
      rpc: async (fn: string, params: any) => {
        if (fn === "init_ai_chat") {
          initChatCalls.push(params);
          // Simulate atomic thread + user message creation
          const threadId = params.p_thread_id ?? `thread-${++supabaseStub.state.threadCount}`;
          supabaseStub.state.threads.push({
            id: threadId,
            user_id: params.p_user_id,
            org_id: params.p_org_id,
            surface: params.p_surface,
            title: params.p_title,
          });
          supabaseStub.state.messages.push({
            id: `user-${supabaseStub.state.messages.length + 1}`,
            thread_id: threadId,
            org_id: params.p_org_id,
            user_id: params.p_user_id,
            role: "user",
            content: params.p_message,
            intent: params.p_intent ?? null,
            context_surface: params.p_context_surface ?? params.p_surface,
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
  POST = createChatPostHandler({
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => aiContext,
    buildPromptContext: async (input: any) => {
      buildPromptContextCalls.push(input);
      return {
        systemPrompt: "System prompt",
        orgContextMessage: null,
        metadata: { surface: input.surface, estimatedTokens: 100 },
      };
    },
    createZaiClient: () => ({ client: "fake" } as any),
    getZaiModel: () => "glm-5",
    composeResponse: (async function* (options: {
      onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
    }) {
      options.onUsage?.({ inputTokens: 12, outputTokens: 7 });
      yield { type: "chunk", content: "Hello" };
      yield { type: "chunk", content: " world" };
    }) as any,
    logAiRequest: async (_serviceSupabase: unknown, entry: unknown) => {
      auditEntries.push(entry);
    },
    retrieveRelevantChunks: async (input: any) => {
      retrieveRelevantChunksCalls.push(input);
      return [
        {
          contentText: "Knowledge chunk",
          sourceTable: "announcements",
          similarity: 0.91,
          metadata: { id: "chunk-1" },
        },
      ];
    },
    resolveOwnThread: async () => ({
      ok: true,
      thread: {
        id: "thread-1",
        user_id: ADMIN_USER.id,
        org_id: ORG_ID,
        surface: "general",
        title: "Thread",
      },
    }),
  });
  process.env.ZAI_API_KEY = "test-key";
  process.env.DISABLE_AI_CACHE = "true";
  delete process.env.EMBEDDING_API_KEY;
});

test("POST /api/ai/[orgId]/chat reroutes members questions per message without mutating thread surface", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Tell me about members",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");

  const body = await response.text();
  assert.match(body, /"type":"chunk"/);
  assert.match(body, /Hello/);
  assert.match(body, /"type":"done"/);
  assert.match(body, /"usage":\{"inputTokens":12,"outputTokens":7\}/);

  assert.equal(initChatCalls.length, 1);
  assert.equal(initChatCalls[0].p_surface, "general");
  assert.equal(initChatCalls[0].p_context_surface, "members");
  assert.equal(initChatCalls[0].p_intent, "members_query");

  assert.equal(buildPromptContextCalls.length, 1);
  assert.equal(buildPromptContextCalls[0].surface, "members");

  assert.equal(supabaseStub.state.threads.length, 1);
  assert.equal(supabaseStub.state.threads[0].surface, "general");

  const userMessage = supabaseStub.state.messages.find((message) => message.role === "user");
  const assistantMessage = supabaseStub.state.messages.find((message) => message.role === "assistant");

  assert.equal(userMessage?.intent, "members_query");
  assert.equal(userMessage?.context_surface, "members");
  assert.equal(assistantMessage?.intent, "members_query");
  assert.equal(assistantMessage?.context_surface, "members");

  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].orgId, ORG_ID);
  assert.equal(auditEntries[0].intent, "members_query");
  assert.equal(auditEntries[0].contextSurface, "members");
  assert.equal(auditEntries[0].inputTokens, 12);
  assert.equal(auditEntries[0].outputTokens, 7);
});

test("POST /api/ai/[orgId]/chat falls back to the current surface when intent is mixed", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Compare members, donations, and events",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  assert.equal(response.status, 200);
  await response.text();
  assert.equal(initChatCalls.length, 1);
  assert.equal(initChatCalls[0].p_surface, "general");
  assert.equal(initChatCalls[0].p_context_surface, "general");
  assert.equal(initChatCalls[0].p_intent, "ambiguous_query");
  assert.equal(buildPromptContextCalls[0].surface, "general");

  const userMessage = supabaseStub.state.messages.find((message) => message.role === "user");
  assert.equal(userMessage?.context_surface, "general");
  assert.equal(auditEntries[0].intent, "ambiguous_query");
  assert.equal(auditEntries[0].contextSurface, "general");
});

test("POST /api/ai/[orgId]/chat skips RAG retrieval for casual messages regardless of surface", async () => {
  process.env.EMBEDDING_API_KEY = "embed-key";

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "thanks!",
      surface: "members",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  assert.equal(response.status, 200);
  await response.text();

  assert.equal(retrieveRelevantChunksCalls.length, 0);
  assert.equal(buildPromptContextCalls.length, 1);
  assert.equal(buildPromptContextCalls[0].surface, "members");
  assert.equal(buildPromptContextCalls[0].ragChunks, undefined);
  assert.equal(auditEntries[0].ragChunkCount, undefined);
  assert.equal(auditEntries[0].ragTopSimilarity, undefined);
  assert.equal(auditEntries[0].ragError, undefined);
});

test("POST /api/ai/[orgId]/chat still runs RAG retrieval for non-casual messages", async () => {
  process.env.EMBEDDING_API_KEY = "embed-key";

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "What policies should members follow?",
      surface: "members",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  assert.equal(response.status, 200);
  await response.text();

  assert.equal(retrieveRelevantChunksCalls.length, 1);
  assert.equal(retrieveRelevantChunksCalls[0].query, "What policies should members follow?");
  assert.equal(retrieveRelevantChunksCalls[0].orgId, ORG_ID);
  assert.equal(buildPromptContextCalls.length, 1);
  assert.equal(buildPromptContextCalls[0].surface, "members");
  assert.deepEqual(buildPromptContextCalls[0].ragChunks, [
    {
      contentText: "Knowledge chunk",
      sourceTable: "announcements",
      metadata: { id: "chunk-1" },
    },
  ]);
  assert.equal(auditEntries[0].ragChunkCount, 1);
  assert.equal(auditEntries[0].ragTopSimilarity, 0.91);
  assert.equal(auditEntries[0].ragError, undefined);
});

test("POST /api/ai/[orgId]/chat returns 403 when org access is unauthorized", async () => {
  aiContext = {
    ok: false,
    response: NextResponse.json(
      { error: "AI assistant requires admin role" },
      { status: 403 }
    ),
  };

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Tell me about members",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.deepEqual(body, { error: "AI assistant requires admin role" });
});
