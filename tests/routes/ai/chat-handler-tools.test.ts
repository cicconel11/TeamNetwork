/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { StageTimeoutError } from "../../../src/lib/ai/timeout.ts";

const ORG_ID = "org-uuid-1";
const VALID_IDEMPOTENCY_KEY = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = { id: "org-admin-user", email: "admin@example.com" };

let auditEntries: any[] = [];
let executeToolCallCalls: any[] = [];
let composeResponseCalls: any[] = [];

function okToolResult(data: unknown) {
  return { kind: "ok" as const, data };
}

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
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
    };

    const resolve = () => {
      if (table === "ai_messages") {
        if (
          query.op === "select" &&
          query.filters.some(
            (f) => f.kind === "eq" && f.column === "idempotency_key"
          )
        ) {
          return { data: null, error: null };
        }

        if (query.op === "select") {
          return { data: [], error: null };
        }

        if (query.op === "insert" && query.inserted?.role === "assistant") {
          const id = `assistant-${++state.assistantCount}`;
          state.messages.push({ id, ...query.inserted });
          return { data: { id }, error: null };
        }

        if (query.op === "insert") {
          state.messages.push({
            id: `user-${state.messages.length + 1}`,
            ...query.inserted,
            created_at: new Date().toISOString(),
          });
          return { data: null, error: null };
        }

        if (query.op === "update") {
          for (const row of state.messages) {
            const matches = query.filters.every((filter) => {
              if (filter.kind === "eq") return row[filter.column] === filter.value;
              if (filter.kind === "in")
                return (
                  Array.isArray(filter.value) &&
                  filter.value.includes(row[filter.column])
                );
              if (filter.kind === "lt")
                return (
                  String(row[filter.column] ?? "") < String(filter.value)
                );
              return true;
            });
            if (matches) Object.assign(row, query.updated);
          }
          return { data: null, error: null };
        }
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => resolve();
    builder.single = async () => resolve();
    builder.then = (onFulfilled: any, onRejected?: any) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected);
    return builder;
  }

  return {
    auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
    from,
    state,
  };
}

let supabaseStub: ReturnType<typeof createSupabaseStub>;

const { createChatPostHandler } = await import(
  "../../../src/app/api/ai/[orgId]/chat/handler.ts"
);
let POST: ReturnType<typeof createChatPostHandler>;

function buildDefaultDeps(overrides: Record<string, any> = {}) {
  return {
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => ({
      ok: true,
      orgId: ORG_ID,
      userId: ADMIN_USER.id,
      userEmail: ADMIN_USER.email,
      role: "admin",
      supabase: supabaseStub,
      serviceSupabase: {
        rpc: async (_fn: string, params: any) => ({
          data: {
            thread_id:
              params.p_thread_id ??
              `thread-${++supabaseStub.state.threadCount}`,
            user_msg_id: "user-1",
          },
          error: null,
        }),
      },
    }),
    buildPromptContext: async (input: any) => ({
      systemPrompt: "System prompt",
      orgContextMessage: null,
      metadata: { surface: input.surface, estimatedTokens: 100 },
    }),
    createZaiClient: () => ({ client: "fake" } as any),
    getZaiModel: () => "glm-5",
    composeResponse: async function* (options: any) {
      composeResponseCalls.push(options);
      // First call: yield a tool call if tools are provided
      if (options.tools && !options.toolResults) {
        const firstToolName = options.tools[0]?.function?.name ?? "list_members";
        const argsJson =
          firstToolName === "get_org_stats"
            ? "{}"
            : firstToolName === "suggest_connections"
              ? '{"person_query":"Louis Ciccone"}'
              : '{"limit": 5}';
        yield {
          type: "tool_call_requested",
          id: "call-1",
          name: firstToolName,
          argsJson,
        };
      } else {
        // Second call (with tool results) or no-tools call: yield text
        options.onUsage?.({ inputTokens: 10, outputTokens: 5 });
        yield { type: "chunk", content: "Here are 5 members..." };
      }
    },
    logAiRequest: async (_sb: unknown, entry: unknown) => {
      auditEntries.push(entry);
    },
    retrieveRelevantChunks: async () => [],
    resolveOwnThread: async () => ({
      ok: true,
      thread: {
        id: "t1",
        user_id: ADMIN_USER.id,
        org_id: ORG_ID,
        surface: "general",
        title: "T",
      },
    }),
    executeToolCall: async (ctx: any, call: any) => {
      executeToolCallCalls.push({ ctx, call });
      if (call.name === "suggest_connections") {
        return okToolResult({
          state: "resolved",
          mode: "sql_fallback",
          fallback_reason: "disabled",
          freshness: { state: "unknown", as_of: "2026-03-24T00:00:00.000Z" },
          source_person: { name: "Louis Ciccone", subtitle: "Captain • Acme" },
          suggestions: [
            {
              name: "Dina Direct",
              subtitle: "VP Product • Acme",
              reasons: [
                { code: "direct_mentorship", label: "direct mentorship", weight: 100 },
              ],
            },
          ],
        });
      }
      return okToolResult([{ id: "m1", name: "Alice" }]);
    },
    verifyToolBackedResponse: () => ({ grounded: true, failures: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore?.clear();
  supabaseStub = createSupabaseStub();
  auditEntries = [];
  executeToolCallCalls = [];
  composeResponseCalls = [];

  POST = createChatPostHandler(buildDefaultDeps());

  process.env.ZAI_API_KEY = "test-key";
  process.env.DISABLE_AI_CACHE = "true";
  delete process.env.EMBEDDING_API_KEY;
});

function makeRequest(message = "List our members") {
  return new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });
}

function toolNamesForCall(index = 0): string[] | undefined {
  const tools = composeResponseCalls[index]?.tools;
  return tools?.map((tool: any) => tool.function.name);
}

test("tool call: SSE stream contains tool_status calling, done, and final chunk", async () => {
  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();

  assert.match(body, /"type":"tool_status".*"status":"calling"/);
  assert.match(body, /"type":"tool_status".*"status":"done"/);
  assert.match(body, /Here are 5 members/);
  assert.match(body, /"type":"done"/);
});

test("tool call: executor receives correct context and args", async () => {
  await (
    await POST(makeRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].ctx.orgId, ORG_ID);
  assert.equal(executeToolCallCalls[0].ctx.userId, ADMIN_USER.id);
  assert.equal(executeToolCallCalls[0].call.name, "list_members");
  assert.deepEqual(executeToolCallCalls[0].call.args, { limit: 5 });
});

test("tool call: pass 2 receives toolResults without tools param", async () => {
  await (
    await POST(makeRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 2);
  assert.deepEqual(toolNamesForCall(0), [
    "list_members",
    "get_org_stats",
    "suggest_connections",
  ]);
  assert.equal(
    composeResponseCalls[1].tools,
    undefined,
    "pass 2 should NOT have tools"
  );
  assert.ok(composeResponseCalls[1].toolResults, "pass 2 should have toolResults");
  assert.equal(composeResponseCalls[1].toolResults[0].toolCallId, "call-1");
  assert.equal(composeResponseCalls[1].toolResults[0].name, "list_members");
  assert.deepEqual(composeResponseCalls[1].toolResults[0].args, { limit: 5 });
});

test("casual messages do not attach tools on pass 1", async () => {
  await (
    await POST(makeRequest("hi") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.equal(composeResponseCalls[0].tools, undefined);
  assert.equal(executeToolCallCalls.length, 0);
});

test("hybrid greeting with events question uses routed events tool set", async () => {
  await (
    await POST(makeRequest("hey, what events are coming up?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_events", "get_org_stats"]);
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "list_events");
});

test("ambiguous queries keep fallback surface tool set", async () => {
  await (
    await POST(makeRequest("Compare members and events") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), [
    "list_members",
    "list_events",
    "get_org_stats",
    "suggest_connections",
  ]);
});

test("analytics surface only attaches get_org_stats", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Show me our donation metrics",
      surface: "analytics",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["get_org_stats"]);
  assert.equal(executeToolCallCalls[0].call.name, "get_org_stats");
  assert.deepEqual(executeToolCallCalls[0].call.args, {});
});

test("tool call: audit entry includes toolCalls", async () => {
  await (
    await POST(makeRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(auditEntries.length, 1);
  assert.ok(auditEntries[0].toolCalls);
  assert.equal(auditEntries[0].toolCalls[0].name, "list_members");
  assert.deepEqual(auditEntries[0].toolCalls[0].args, { limit: 5 });
});

test("direct-name connection prompts only attach suggest_connections on pass 1", async () => {
  await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["suggest_connections"]);
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "suggest_connections");
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    person_query: "Louis Ciccone",
  });
});

test("direct-name connection prompts pass a fixed-template contract into pass 2", async () => {
  await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 2);
  assert.match(composeResponseCalls[1].systemPrompt, /CONNECTION ANSWER CONTRACT/);
  assert.deepEqual(composeResponseCalls[1].toolResults[0].data, {
    state: "resolved",
    mode: "sql_fallback",
    fallback_reason: "disabled",
    freshness: { state: "unknown", as_of: "2026-03-24T00:00:00.000Z" },
    source_person: { name: "Louis Ciccone", subtitle: "Captain • Acme" },
    suggestions: [
      {
        name: "Dina Direct",
        subtitle: "VP Product • Acme",
        reasons: [
          { code: "direct_mentorship", label: "direct mentorship", weight: 100 },
        ],
      },
    ],
  });
});

test("direct-name connection prompts log suggest_connections in audit metadata", async () => {
  await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].contextSurface, "members");
  assert.equal(auditEntries[0].toolCalls[0].name, "suggest_connections");
  assert.deepEqual(auditEntries[0].toolCalls[0].args, {
    person_query: "Louis Ciccone",
  });
  assert.notEqual(auditEntries[0].error, "tool_grounding_failed");
});

test("tool call: cache write is prevented (bypassReason set in done event)", async () => {
  // Even with cache enabled, tool-triggering prompts hit LIVE_CONTEXT_MARKERS
  // and are marked ineligible. The tool_call_made guard is belt-and-suspenders.
  delete process.env.DISABLE_AI_CACHE;
  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  // bypassReason is set (either requires_live_org_context or unsupported_surface)
  assert.match(body, /bypassReason/);
  // Cache status should NOT be "miss" (would allow writes)
  assert.doesNotMatch(body, /"status":"miss"/);
  // Restore
  process.env.DISABLE_AI_CACHE = "true";
});

test("no tool call: first pass chunks stream before completion", async () => {
  let releaseSecondChunk!: () => void;
  const secondChunkGate = new Promise<void>((resolve) => {
    releaseSecondChunk = resolve;
  });

  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        options.onUsage?.({ inputTokens: 8, outputTokens: 4 });
        yield { type: "chunk", content: "Hello" };
        await secondChunkGate;
        yield { type: "chunk", content: " world" };
      },
    })
  );

  const response = await POST(makeRequest("hello") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });

  const reader = response.body?.getReader();
  assert.ok(reader, "response should expose a readable stream");

  const firstRead = await Promise.race([
    reader!.read(),
    delay(50).then(() => "timeout" as const),
  ]);

  assert.notEqual(firstRead, "timeout", "first chunk should stream before completion");
  if (firstRead !== "timeout") {
    const text = new TextDecoder().decode(firstRead.value);
    assert.match(text, /"type":"chunk"/);
    assert.match(text, /Hello/);
  }

  releaseSecondChunk();
  const remaining: string[] = [];
  while (true) {
    const chunk = await reader!.read();
    if (chunk.done) break;
    remaining.push(new TextDecoder().decode(chunk.value));
  }

  assert.match(remaining.join(""), /world/);
  assert.match(remaining.join(""), /"type":"done"/);
});

test("tool call: pass 1 text before tool execution is buffered while pass 2 completes", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          // Emit "thinking" text BEFORE the tool call
          yield { type: "chunk", content: "Let me check..." };
          yield {
            type: "tool_call_requested",
            id: "call-2",
            name: "get_org_stats",
            argsJson: "{}",
          };
        } else {
          options.onUsage?.({ inputTokens: 8, outputTokens: 4 });
          yield { type: "chunk", content: "You have 42 active members." };
        }
      },
    })
  );

  const response = await POST(makeRequest("How many members?") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.doesNotMatch(body, /Let me check/);
  assert.match(body, /You have 42 active members/);
  assert.match(body, /"type":"tool_status".*"status":"calling"/);
  assert.match(body, /"type":"tool_status".*"status":"done"/);
});

test("tool_error keeps the turn alive and pass 2 completes", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: "{}",
          };
        } else {
          options.onUsage?.({ inputTokens: 5, outputTokens: 3 });
          yield { type: "chunk", content: "I could not look that up." };
        }
      },
      executeToolCall: async () => ({ kind: "tool_error", error: "Query failed" }),
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /"type":"tool_status".*"status":"error"/);
  assert.match(body, /I could not look that up/);
  assert.match(body, /"type":"done"/);
});

test("timeout opens the breaker, skips later tools, and still runs pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: "{}",
          };
          yield {
            type: "tool_call_requested",
            id: "call-2",
            name: "get_org_stats",
            argsJson: "{}",
          };
          return;
        }

        yield { type: "chunk", content: "Tool request timed out, please retry." };
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        if (call.name === "list_members") {
          return { kind: "timeout", error: "Tool timed out" };
        }
        return okToolResult({ tool: call.name });
      },
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "list_members");
  assert.match(body, /"type":"tool_status".*"status":"calling"/);
  assert.match(body, /"type":"tool_status".*"status":"error"/);
  assert.match(body, /Tool request timed out, please retry/);
  assert.match(body, /"type":"done"/);
  assert.equal(composeResponseCalls[1].toolResults.length, 1);
  assert.match(JSON.stringify(composeResponseCalls[1].toolResults[0].data), /Tool timed out/);
});

test("forbidden tool result is turn-fatal and suppresses buffered pass 1 text", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield { type: "chunk", content: "Checking access..." };
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: "{}",
          };
          return;
        }

        yield { type: "chunk", content: "should not run" };
      },
      executeToolCall: async () => ({ kind: "forbidden", error: "Forbidden" }),
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.doesNotMatch(body, /Checking access/);
  assert.match(body, /Your access to AI tools for this organization has changed/);
  assert.doesNotMatch(body, /should not run/);
  assert.doesNotMatch(body, /"type":"done"/);
  assert.equal(composeResponseCalls.length, 1);
});

test("auth_error is turn-fatal and logs no retryable prompt", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: "{}",
          };
        }
      },
      executeToolCall: async () => ({ kind: "auth_error", error: "Auth check failed" }),
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /Unable to verify access to AI tools right now/);
  assert.doesNotMatch(body, /"retryable":true/);
  assert.doesNotMatch(body, /"type":"done"/);
  assert.equal(composeResponseCalls.length, 1);
});

test("pass 1 timeout preserves partial text and ends without done", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.signal?.aborted) {
          throw options.signal.reason;
        }
        yield { type: "chunk", content: "Partial answer..." };
        throw new StageTimeoutError("pass1_model", 15_000);
      },
    })
  );

  const response = await POST(makeRequest("hello") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /Partial answer/);
  assert.match(body, /The response timed out\. Please try again/);
  assert.doesNotMatch(body, /"type":"done"/);
});

test("pass 2 timeout suppresses buffered text and ends without done", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: "{}",
          };
          return;
        }
        yield { type: "chunk", content: "Fallback summary..." };
        throw new StageTimeoutError("pass2_model", 15_000);
      },
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.doesNotMatch(body, /Fallback summary/);
  assert.match(body, /The response timed out\. Please try again/);
  assert.doesNotMatch(body, /"type":"done"/);
});

test("tool call: multiple tool calls are executed and audited", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: '{"limit": 5}',
          };
          yield {
            type: "tool_call_requested",
            id: "call-2",
            name: "get_org_stats",
            argsJson: "{}",
          };
          return;
        }

        options.onUsage?.({ inputTokens: 4, outputTokens: 2 });
        yield { type: "chunk", content: "Here is the combined result." };
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({ tool: call.name });
      },
    })
  );

  const response = await POST(makeRequest("Give me members and stats") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /combined result/);
  assert.equal(executeToolCallCalls.length, 2);
  assert.deepEqual(
    executeToolCallCalls.map((entry) => entry.call.name),
    ["list_members", "get_org_stats"]
  );
  assert.equal(composeResponseCalls[1].toolResults.length, 2);
  assert.equal(auditEntries.length, 1);
  assert.deepEqual(
    auditEntries[0].toolCalls.map((entry: any) => entry.name),
    ["list_members", "get_org_stats"]
  );
});

test("tool call: usage is accumulated across both passes", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          options.onUsage?.({ inputTokens: 10, outputTokens: 3 });
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: '{"limit": 5}',
          };
          return;
        }

        options.onUsage?.({ inputTokens: 4, outputTokens: 2 });
        yield { type: "chunk", content: "Here are 5 members..." };
      },
    })
  );

  const response = await POST(makeRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /"usage":\{"inputTokens":14,"outputTokens":5\}/);
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].inputTokens, 14);
  assert.equal(auditEntries[0].outputTokens, 5);
});

test("no tool call: normal flow works without tool loop", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        // No tool call — just text
        options.onUsage?.({ inputTokens: 6, outputTokens: 3 });
        yield { type: "chunk", content: "Hello, how can I help?" };
      },
    })
  );

  const response = await POST(makeRequest("hi") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /Hello, how can I help/);
  assert.match(body, /"type":"done"/);
  // Should not have any tool_status events
  assert.doesNotMatch(body, /tool_status/);
  // Only one compose call (no pass 2)
  assert.equal(composeResponseCalls.length, 1);
  // Audit should not have toolCalls
  assert.equal(auditEntries.length, 1, "should have 1 audit entry");
  assert.equal(auditEntries[0].toolCalls, undefined);
});
