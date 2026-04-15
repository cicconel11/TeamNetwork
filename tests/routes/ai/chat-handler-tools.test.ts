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

function buildThreadId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function okToolResult(data: unknown) {
  return { kind: "ok" as const, data };
}

function createSupabaseStub() {
  const state = {
    threadCount: 0,
    assistantCount: 0,
    threads: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    discussionThreads: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        organization_id: ORG_ID,
        title: "Spring Fundraising Volunteers",
        deleted_at: null,
      },
    ] as Array<Record<string, unknown>>,
    discussionThreadLookupError: null as unknown,
  };

  function applyFilters(
    rows: Array<Record<string, unknown>>,
    filters: Array<{ kind: "eq" | "in" | "lt" | "gt" | "is" | "ilike"; column: string; value: unknown }>
  ) {
    return rows.filter((row) =>
      filters.every((filter) => {
        const value = row[filter.column];
        if (filter.kind === "eq") return value === filter.value;
        if (filter.kind === "is") return value === filter.value;
        if (filter.kind === "ilike") {
          if (typeof value !== "string" || typeof filter.value !== "string") return false;
          const escapedPattern = filter.value
            .replace(/([.+^${}()|[\]\\])/g, "\\$1")
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          return new RegExp(`^${escapedPattern}$`, "i").test(value);
        }
        if (filter.kind === "in") {
          return Array.isArray(filter.value) && filter.value.includes(value);
        }
        if (filter.kind === "lt") {
          return String(value ?? "") < String(filter.value);
        }
        if (filter.kind === "gt") {
          return String(value ?? "") > String(filter.value);
        }
        return true;
      })
    );
  }

  function from(table: string) {
    const query = {
      table,
      op: "select" as "select" | "insert" | "update",
      inserted: null as Record<string, unknown> | null,
      updated: null as Record<string, unknown> | null,
      filters: [] as Array<{ kind: "eq" | "in" | "lt" | "gt" | "is" | "ilike"; column: string; value: unknown }>,
      orderBy: null as { column: string; ascending: boolean } | null,
      limitValue: null as number | null,
      singleMode: null as "single" | "maybeSingle" | null,
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
      is(column: string, value: unknown) {
        query.filters.push({ kind: "is", column, value });
        return builder;
      },
      ilike(column: string, value: string) {
        query.filters.push({ kind: "ilike", column, value });
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
      gt(column: string, value: unknown) {
        query.filters.push({ kind: "gt", column, value });
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
      if (table === "ai_messages") {
        if (query.op === "select") {
          let rows = applyFilters(state.messages, query.filters);
          if (query.orderBy) {
            rows = [...rows].sort((a, b) => {
              const left = String(a[query.orderBy!.column] ?? "");
              const right = String(b[query.orderBy!.column] ?? "");
              return query.orderBy!.ascending ? left.localeCompare(right) : right.localeCompare(left);
            });
          }
          if (typeof query.limitValue === "number") {
            rows = rows.slice(0, query.limitValue);
          }
          return {
            data:
              query.filters.some((f) => f.kind === "eq" && f.column === "idempotency_key")
                ? (rows[0] ?? null)
                : rows,
            error: null,
          };
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
            const matches = applyFilters([row], query.filters).length === 1;
            if (matches) Object.assign(row, query.updated);
          }
          return { data: null, error: null };
        }
      }

      if (table === "discussion_threads" && query.op === "select") {
        if (state.discussionThreadLookupError) {
          return { data: null, error: state.discussionThreadLookupError };
        }

        let rows = applyFilters(state.discussionThreads, query.filters);
        if (query.orderBy) {
          rows = [...rows].sort((a, b) => {
            const left = String(a[query.orderBy!.column] ?? "");
            const right = String(b[query.orderBy!.column] ?? "");
            return query.orderBy!.ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        if (typeof query.limitValue === "number") {
          rows = rows.slice(0, query.limitValue);
        }
        return {
          data: query.singleMode ? (rows[0] ?? null) : rows,
          error: null,
        };
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => {
      query.singleMode = "maybeSingle";
      return resolve();
    };
    builder.single = async () => {
      query.singleMode = "single";
      return resolve();
    };
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
      role: "admin",
      supabase: supabaseStub,
      serviceSupabase: {
        from: supabaseStub.from,
        rpc: async (_fn: string, params: any) => ({
          data: {
            thread_id:
              params.p_thread_id ??
              buildThreadId(++supabaseStub.state.threadCount),
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
    getZaiModel: () => "glm-5.1",
    composeResponse: async function* (options: any) {
      composeResponseCalls.push(options);
      // First call: yield a tool call if tools are provided
      if (options.tools && !options.toolResults) {
        const firstToolName = options.tools[0]?.function?.name ?? "list_members";
        const argsJson =
          firstToolName === "get_org_stats"
            ? "{}"
            : firstToolName === "get_enterprise_stats"
              ? "{}"
            : firstToolName === "get_enterprise_quota"
              ? "{}"
            : firstToolName === "get_enterprise_org_capacity"
              ? "{}"
            : firstToolName === "find_navigation_targets"
              ? '{"query":"open announcements"}'
            : firstToolName === "list_announcements"
              ? '{"limit": 5}'
            : firstToolName === "prepare_announcement"
              ? '{"title":"Practice Update","body":"Practice starts at 6pm tomorrow.","audience":"all","send_notification":true}'
            : firstToolName === "prepare_chat_message"
              ? '{"person_query":"Jason Leonard","body":"Can you join the alumni panel next Thursday?"}'
            : firstToolName === "list_chat_groups"
              ? '{"limit": 5}'
            : firstToolName === "prepare_group_message"
              ? '{"group_name_query":"CEO boss men","body":"Hey everyone, quick check-in."}'
            : firstToolName === "prepare_discussion_reply"
              ? '{"discussion_thread_id":"33333333-3333-4333-8333-333333333333","thread_title":"Spring Fundraising Volunteers","body":"I can take the Friday evening shift."}'
            : firstToolName === "suggest_connections"
            ? '{"person_query":"Louis Ciccone"}'
            : firstToolName === "prepare_discussion_thread"
              ? '{"title":"Spring Fundraising Volunteers","body":"Let\\u2019s organize volunteer assignments for the spring fundraiser."}'
            : firstToolName === "scrape_schedule_website"
              ? '{"url":"https://example.com/schedule"}'
            : firstToolName === "extract_schedule_pdf"
              ? "{}"
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
    resolveOwnThread: async (threadId: string) => ({
      ok: true,
      thread: {
        id: threadId,
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
                { code: "shared_company", label: "shared company", weight: 30 },
                { code: "shared_industry", label: "shared industry", weight: 40 },
              ],
            },
          ],
        });
      }
      if (call.name === "find_navigation_targets") {
        return okToolResult({
          state: "resolved",
          query: "open announcements",
          matches: [
            {
              label: "Announcements",
              href: "/acme/announcements",
              description: "Open the announcements page.",
              kind: "page",
            },
          ],
        });
      }
      if (call.name === "list_announcements") {
        return okToolResult([
          {
            id: "announcement-1",
            title: "Welcome back",
            audience: "all",
            is_pinned: true,
            published_at: "2026-03-20T12:00:00Z",
            body_preview: "Practice starts Monday.",
          },
        ]);
      }
      if (call.name === "prepare_announcement") {
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            title: "Practice Update",
            body: "Practice starts at 6pm tomorrow.",
            audience: "all",
            is_pinned: false,
            send_notification: true,
          },
          pending_action: {
            id: "pending-announcement-123",
            action_type: "create_announcement",
            payload: {
              title: "Practice Update",
              body: "Practice starts at 6pm tomorrow.",
              audience: "all",
              is_pinned: false,
              send_notification: true,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review announcement",
              description: "Confirm the drafted announcement before it is published.",
            },
          },
        });
      }
      if (call.name === "prepare_chat_message") {
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            person_query: "Jason Leonard",
            recipient_member_id: "11111111-1111-4111-8111-111111111111",
            body: "Can you join the alumni panel next Thursday?",
          },
          pending_action: {
            id: "pending-chat-123",
            action_type: "send_chat_message",
            payload: {
              recipient_member_id: "11111111-1111-4111-8111-111111111111",
              recipient_user_id: "22222222-2222-4222-8222-222222222222",
              recipient_display_name: "Jason Leonard",
              existing_chat_group_id: "chat-123",
              body: "Can you join the alumni panel next Thursday?",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review chat message",
              description: "Confirm the drafted chat message before it is sent.",
            },
          },
        });
      }
      if (call.name === "list_chat_groups") {
        return okToolResult([
          {
            id: "group-1",
            name: "CEO boss men",
            role: "admin",
            updated_at: "2026-04-13T12:00:00.000Z",
          },
          {
            id: "group-2",
            name: "Louis Ciccone",
            role: "member",
            updated_at: "2026-04-12T12:00:00.000Z",
          },
        ]);
      }
      if (call.name === "prepare_group_message") {
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            chat_group_id: "group-1",
            group_name_query: "CEO boss men",
            body: "Hey everyone, quick check-in.",
          },
          pending_action: {
            id: "pending-group-chat-123",
            action_type: "send_group_chat_message",
            payload: {
              chat_group_id: "group-1",
              group_name: "CEO boss men",
              message_status: "approved",
              body: "Hey everyone, quick check-in.",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review group message",
              description: "Confirm the drafted group message before it is sent.",
            },
          },
        });
      }
      if (call.name === "prepare_discussion_reply") {
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            discussion_thread_id: "33333333-3333-4333-8333-333333333333",
            thread_title: "Spring Fundraising Volunteers",
            body: "I can take the Friday evening shift.",
          },
          pending_action: {
            id: "pending-reply-123",
            action_type: "create_discussion_reply",
            payload: {
              discussion_thread_id: "33333333-3333-4333-8333-333333333333",
              thread_title: "Spring Fundraising Volunteers",
              body: "I can take the Friday evening shift.",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion reply",
              description: "Confirm the drafted reply before it is posted to the discussion thread.",
            },
          },
        });
      }
      if (call.name === "prepare_discussion_thread") {
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            title: "Spring Fundraising Volunteers",
            body: "Let's organize volunteer assignments for the spring fundraiser.",
          },
          pending_action: {
            id: "pending-123",
            action_type: "create_discussion_thread",
            payload: {
              title: "Spring Fundraising Volunteers",
              body: "Let's organize volunteer assignments for the spring fundraiser.",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion thread",
              description: "Confirm the drafted thread before it is posted to discussions.",
            },
          },
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

function toolChoiceForCall(index = 0) {
  return composeResponseCalls[index]?.toolChoice;
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
  assert.deepEqual(executeToolCallCalls[0].ctx.authorization, {
    kind: "preverified_admin",
    source: "ai_org_context",
  });
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
    "list_alumni",
    "list_parents",
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

  assert.deepEqual(toolNamesForCall(0), ["list_events"]);
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "list_events");
});

test("explicit message requests route to prepare_chat_message", async () => {
  const response = await POST(makeRequest("Message Jason Leonard and ask if he can join the alumni panel next Thursday.") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(toolNamesForCall(0), ["prepare_chat_message"]);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_chat_message");
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    person_query: "Jason Leonard",
    body: "Can you join the alumni panel next Thursday?",
  });
  assert.match(body, /I drafted the chat message/);
  assert.match(body, /"type":"pending_action"/);
});

test("list group chat requests route to list_chat_groups", async () => {
  const response = await POST(makeRequest("What chat groups can I message right now?") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(toolNamesForCall(0), ["list_chat_groups"]);
  assert.equal(executeToolCallCalls[0].call.name, "list_chat_groups");
  assert.match(body, /You can message these chat groups/i);
  assert.match(body, /CEO boss men \(admin\)/);
});

test("explicit group message requests route to prepare_group_message", async () => {
  const response = await POST(makeRequest("Send a message to the CEO boss men group saying hey everyone, quick check-in.") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(toolNamesForCall(0), ["prepare_group_message"]);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_group_message");
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    group_name_query: "CEO boss men",
    body: "Hey everyone, quick check-in.",
  });
  assert.match(body, /I drafted the group message/i);
  assert.match(body, /"type":"pending_action"/);
});

test("messages-page follow-up routes group send requests to prepare_group_message", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Send a message to the CEO boss men group saying hey everyone, quick check-in.",
      surface: "general",
      currentPath: "/acme/messages/chat/group-1",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(toolNamesForCall(0), ["prepare_group_message"]);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_group_message");
  assert.match(body, /I drafted the group message/i);
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
    "list_announcements",
    "list_discussions",
    "list_job_postings",
    "list_alumni",
    "list_parents",
    "list_philanthropy_events",
    "list_donations",
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

test("enterprise org_admin billing prompts force deterministic quota-access denial", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      getAiOrgContext: async () => ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        enterpriseId: "ent-1",
        enterpriseRole: "org_admin",
        supabase: supabaseStub,
        serviceSupabase: {
          from: supabaseStub.from,
          rpc: async (_fn: string, params: any) => ({
            data: {
              thread_id:
                params.p_thread_id ??
                buildThreadId(++supabaseStub.state.threadCount),
              user_msg_id: "user-1",
            },
            error: null,
          }),
        },
      }),
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return {
          kind: "tool_error" as const,
          error: "This tool requires an enterprise owner or billing admin role.",
          code: "enterprise_billing_role_required" as const,
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "get_enterprise_quota",
            argsJson: "{}",
          };
          return;
        }
        throw new Error("deterministic enterprise quota denial should skip pass 2");
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How many seats are left?",
      surface: "analytics",
      currentPath: "/enterprise/acme-ent/billing",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["get_enterprise_quota"]);
  assert.equal(executeToolCallCalls[0].call.name, "get_enterprise_quota");
  assert.match(body, /can’t access enterprise quota or billing details/i);
  assert.doesNotMatch(body, /enterprise currently has/i);
  assert.doesNotMatch(body, /\balumni\b.*across/i);
  assert.equal(composeResponseCalls.length, 1);
});

test("enterprise org_admin free sub-org slot prompts route to enterprise capacity tool", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      getAiOrgContext: async () => ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        enterpriseId: "ent-1",
        enterpriseRole: "org_admin",
        supabase: supabaseStub,
        serviceSupabase: {
          from: supabaseStub.from,
          rpc: async (_fn: string, params: any) => ({
            data: {
              thread_id:
                params.p_thread_id ??
                buildThreadId(++supabaseStub.state.threadCount),
              user_msg_id: "user-1",
            },
            error: null,
          }),
        },
      }),
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        if (call.name === "get_enterprise_org_capacity") {
          return okToolResult({
            sub_orgs: {
              total: 1,
              enterprise_managed_total: 1,
              free_limit: 6,
              free_remaining: 5,
            },
          });
        }
        return okToolResult([]);
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "get_enterprise_org_capacity",
            argsJson: "{}",
          };
          return;
        }
        throw new Error("deterministic enterprise org capacity response should skip pass 2");
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How many free sub-org slots are left?",
      surface: "analytics",
      currentPath: "/enterprise/acme-ent",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["get_enterprise_org_capacity"]);
  assert.equal(executeToolCallCalls[0].call.name, "get_enterprise_org_capacity");
  assert.match(body, /Enterprise managed-org capacity/);
  assert.match(body, /Free sub-org slots remaining: 5/);
  assert.equal(executeToolCallCalls.length, 1);
});

test("simple member roster requests use list_members tool_first and skip pass 2", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_members",
            argsJson: '{"limit":5}',
          };
          return;
        }

        throw new Error("list_members fast path should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "member-1",
            name: "Frank Ciccone",
            role: "admin",
            email: "frank@example.com",
            created_at: "2026-04-02T00:00:00.000Z",
          },
          {
            id: "member-2",
            name: "Patrick Leonard",
            role: "parent",
            email: "patrick@example.com",
            created_at: "2026-03-27T00:00:00.000Z",
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("Tell me about members") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_members"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_members" },
  });
  assert.deepEqual(contextModes, ["tool_first"]);
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Recent active members/);
  assert.match(body, /Frank Ciccone \(Admin\)/);
  assert.match(body, /patrick@example\.com/);
});

test("member count and alumni queries attach get_org_stats only and skip pass 2", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "get_org_stats",
            argsJson: "{}",
          };
          return;
        }

        throw new Error("get_org_stats fast path should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          active_members: 35,
          alumni: 12,
          parents: 4,
          upcoming_events: 3,
          donations: {
            total_amount_cents: 420000,
            donation_count: 18,
            last_donation_at: "2026-03-24T00:00:00.000Z",
          },
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("How many alumni do we have?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["get_org_stats"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "get_org_stats" },
  });
  assert.deepEqual(contextModes, ["tool_first"]);
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Organization snapshot/);
  assert.match(body, /Alumni: 12/);
});

test("member detail route can trust 'message this person' and inject the current member id", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Message this person and ask if he can join the alumni panel next Thursday.",
      surface: "members",
      currentPath: "/acme/members/11111111-1111-4111-8111-111111111111",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(toolNamesForCall(0), ["prepare_chat_message"]);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_chat_message");
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    recipient_member_id: "11111111-1111-4111-8111-111111111111",
    body: "Can you join the alumni panel next Thursday?",
  });
  assert.match(body, /I drafted the chat message/);
});

test("single-tool org stats requests use tool_first context and skip pass 2", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "get_org_stats",
            argsJson: "{}",
          };
          return;
        }

        throw new Error("get_org_stats should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          active_members: 35,
          alumni: 12,
          parents: 4,
          upcoming_events: 3,
          donations: {
            total_amount_cents: 420000,
            donation_count: 18,
            last_donation_at: "2026-03-24T00:00:00.000Z",
          },
        });
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Show me our donation metrics",
      surface: "analytics",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(contextModes, ["tool_first"]);
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Organization snapshot/);
  assert.match(body, /Active members: 35/);
  assert.match(body, /Donations: 18 donations - \$4200 raised - last donation 2026-03-24/);
  assert.match(body, /"type":"done"/);
});

test("simple event requests use list_events tool_first and skip pass 2", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_events",
            argsJson: '{"limit":5,"upcoming":true}',
          };
          return;
        }

        throw new Error("list_events fast path should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "event-1",
            title: "Spring Fundraiser",
            start_date: "2026-04-10T18:00:00.000Z",
            location: "Philadelphia",
            description: "Annual community fundraiser.",
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("What events are coming up?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_events"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_events" },
  });
  assert.deepEqual(contextModes, ["tool_first"]);
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Matching events/);
  assert.match(body, /Spring Fundraiser/);
});

test("navigation requests only attach find_navigation_targets on pass 1", async () => {
  const body = await (
    await POST(makeRequest("Open announcements") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["find_navigation_targets"]);
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "find_navigation_targets");
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /\[Announcements\]\(\/acme\/announcements\)/);
  assert.match(body, /"type":"done"/);
});

test("action requests do not get forced into find_navigation_targets", async () => {
  await (
    await POST(makeRequest("Send a reminder to all members") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), [
    "list_members",
    "list_alumni",
    "list_parents",
    "get_org_stats",
    "suggest_connections",
  ]);
  assert.equal(executeToolCallCalls[0].call.name, "list_members");
});

test("create announcement requests only attach prepare_announcement on pass 1", async () => {
  const body = await (
    await POST(makeRequest("Publish an announcement reminding everyone about tomorrow's practice") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_announcement"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_announcement" },
  });
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_announcement");
  assert.match(body, /I drafted the announcement/i);
  assert.match(body, /"type":"pending_action"/);
  assert.match(body, /"actionType":"create_announcement"/);
});

test("write announcement prompts still attach prepare_announcement on pass 1", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Write a short urgent announcement for parents that tonight's event has moved indoors.",
      surface: "general",
      currentPath: "/acme/announcements",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_announcement"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_announcement" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "prepare_announcement");
  assert.match(body, /I drafted the announcement/i);
});

test("create discussion requests only attach prepare_discussion_thread on pass 1", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
    })
  );

  const body = await (
    await POST(makeRequest("Create a discussion thread about spring volunteer assignments") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_thread"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_thread" },
  });
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_discussion_thread");
  assert.equal(composeResponseCalls.length, 1);
  assert.deepEqual(contextModes, ["full"]);
  assert.match(body, /I drafted the discussion thread/i);
  assert.match(body, /"type":"pending_action"/);
  assert.match(body, /"actionType":"create_discussion_thread"/);
});

test("discussion reply requests only attach prepare_discussion_reply on pass 1", async () => {
  const body = await (
    await POST(makeRequest("Reply to the discussion thread that I can take the Friday evening shift") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_reply"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_reply" },
  });
  assert.equal(executeToolCallCalls.length, 1);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_discussion_reply");
  assert.match(body, /I drafted the discussion reply/i);
  assert.match(body, /"type":"pending_action"/);
  assert.match(body, /"actionType":"create_discussion_reply"/);
});

test("thread-page response prompts attach prepare_discussion_reply on pass 1", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Draft a response to this thread: My new Thread - Check it out",
      surface: "general",
      currentPath: "/acme/messages/threads/33333333-3333-4333-8333-333333333333",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_reply"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_reply" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "prepare_discussion_reply");
});

test("thread-page discussion replies inject the current discussion thread context when tool args omit it", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_reply",
            argsJson: '{"body":"Thanks everyone for the feedback! We\\u2019ll post the final schedule tomorrow."}',
          };
          return;
        }

        throw new Error("prepare_discussion_reply should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-reply-context-123",
            action_type: "create_discussion_reply",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion reply",
              description: "Confirm the drafted reply before it is posted to the discussion thread.",
            },
          },
        });
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to this thread thanking everyone for the feedback and let them know we'll post the final schedule tomorrow.",
      surface: "general",
      currentPath: "/acme/messages/threads/33333333-3333-4333-8333-333333333333",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(executeToolCallCalls[0].call.args, {
    discussion_thread_id: "33333333-3333-4333-8333-333333333333",
    thread_title: "Spring Fundraising Volunteers",
    body: "Thanks everyone for the feedback! We’ll post the final schedule tomorrow.",
  });
  assert.match(body, /I drafted the discussion reply/i);
});

test("named-thread discussion replies resolve a unique thread title outside route context", async () => {
  supabaseStub.state.discussionThreads.push({
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: ORG_ID,
    title: "My new Thread - Check it out",
    deleted_at: null,
  });

  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_reply",
            argsJson:
              '{"thread_title":"My new Thread - Check it out","body":"Thanks everyone for the feedback."}',
          };
          return;
        }

        throw new Error("prepare_discussion_reply should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-reply-title-123",
            action_type: "create_discussion_reply",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion reply",
              description: "Confirm the drafted reply before it is posted to the discussion thread.",
            },
          },
        });
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to My new Thread - Check it out saying thanks everyone for the feedback.",
      surface: "general",
      currentPath: "/acme/messages",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(executeToolCallCalls[0].call.args, {
    discussion_thread_id: "44444444-4444-4444-8444-444444444444",
    thread_title: "My new Thread - Check it out",
    body: "Thanks everyone for the feedback.",
  });
  assert.match(body, /I drafted the discussion reply/i);
});

test("off-route discussion replies without a target ask for a thread title instead of a UUID", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_reply",
            argsJson: '{"body":"Thanks everyone for the feedback."}',
          };
          return;
        }

        throw new Error("prepare_discussion_reply should not require a second model pass");
      },
      executeToolCall: async () => {
        throw new Error("prepare_discussion_reply should clarify before execution");
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to that thread thanking everyone for the feedback.",
      surface: "general",
      currentPath: "/acme/messages",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(executeToolCallCalls.length, 0);
  assert.match(body, /thread title/i);
  assert.doesNotMatch(body, /uuid/i);
});

test("named-thread discussion replies clarify when multiple thread titles match", async () => {
  supabaseStub.state.discussionThreads.push(
    {
      id: "44444444-4444-4444-8444-444444444441",
      organization_id: ORG_ID,
      title: "Volunteer Logistics",
      deleted_at: null,
    },
    {
      id: "44444444-4444-4444-8444-444444444442",
      organization_id: ORG_ID,
      title: "Volunteer Coordination",
      deleted_at: null,
    }
  );

  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_reply",
            argsJson: '{"thread_title":"Volunteer","body":"Thanks everyone."}',
          };
          return;
        }

        throw new Error("prepare_discussion_reply should not require a second model pass");
      },
      executeToolCall: async () => {
        throw new Error("prepare_discussion_reply should clarify before execution");
      },
    })
  );

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to Volunteer saying thanks everyone.",
      surface: "general",
      currentPath: "/acme/messages",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const body = await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(executeToolCallCalls.length, 0);
  assert.match(body, /Volunteer Logistics/);
  assert.match(body, /Volunteer Coordination/);
  assert.doesNotMatch(body, /uuid/i);
});

test("thread-page discussion reply grounding fails closed on lookup errors", async () => {
  supabaseStub.state.discussionThreadLookupError = { message: "lookup failed" };

  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to this thread thanking everyone for the feedback.",
      surface: "general",
      currentPath: "/acme/messages/threads/33333333-3333-4333-8333-333333333333",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const response = await POST(request as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.match(body, /Failed to resolve the current discussion thread/);
});

test("create discussion requests do not get misrouted to find_navigation_targets", async () => {
  await (
    await POST(makeRequest("Post a discussion thread about spring volunteer assignments") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_thread"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_thread" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "prepare_discussion_thread");
});

test("attached PDFs attach extract_schedule_pdf on pass 1", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Please help with this upload",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
      attachment: {
        storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.pdf",
        fileName: "schedule.pdf",
        mimeType: "application/pdf",
      },
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["extract_schedule_pdf"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "extract_schedule_pdf" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "extract_schedule_pdf");
  assert.deepEqual(executeToolCallCalls[0].ctx.attachment, {
    storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.pdf",
    fileName: "schedule.pdf",
    mimeType: "application/pdf",
  });
});

test("attached PNG schedules attach extract_schedule_pdf on pass 1", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Please help with this upload",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
      attachment: {
        storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.png",
        fileName: "schedule.png",
        mimeType: "image/png",
      },
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["extract_schedule_pdf"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "extract_schedule_pdf" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "extract_schedule_pdf");
  assert.deepEqual(executeToolCallCalls[0].ctx.attachment, {
    storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.png",
    fileName: "schedule.png",
    mimeType: "image/png",
  });
});

test("attached JPEG schedules attach extract_schedule_pdf on pass 1", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Please help with this upload",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
      attachment: {
        storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.jpg",
        fileName: "schedule.jpg",
        mimeType: "image/jpeg",
      },
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["extract_schedule_pdf"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "extract_schedule_pdf" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "extract_schedule_pdf");
  assert.deepEqual(executeToolCallCalls[0].ctx.attachment, {
    storagePath: "org-uuid-1/org-admin-user/1712000000000_schedule.jpg",
    fileName: "schedule.jpg",
    mimeType: "image/jpeg",
  });
});

test("website schedule import attaches scrape_schedule_website on pass 1", async () => {
  await (
    await POST(makeRequest("Import the schedule from https://example.com/schedule") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["scrape_schedule_website"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "scrape_schedule_website" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "scrape_schedule_website");
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    url: "https://example.com/schedule",
  });
});

test("create job requests still prefer prepare_job_posting over job reads", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_job_posting",
            argsJson:
              '{"title":"Senior Product Designer","company":"Acme Corp","location":"San Francisco, CA","industry":"SaaS","experience_level":"senior","description":"Lead product design across our collaboration suite.","application_url":"https://example.com/jobs/senior-product-designer"}',
          };
          return;
        }

        throw new Error("prepare_job_posting should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            title: "Senior Product Designer",
            company: "Acme Corp",
            location: "San Francisco, CA",
            industry: "SaaS",
            experience_level: "senior",
            description: "Lead product design across our collaboration suite.",
            application_url: "https://example.com/jobs/senior-product-designer",
          },
          pending_action: {
            id: "pending-job-123",
            action_type: "create_job_posting",
            payload: {
              title: "Senior Product Designer",
              company: "Acme Corp",
              location: "San Francisco, CA",
              industry: "SaaS",
              experience_level: "senior",
              description: "Lead product design across our collaboration suite.",
              application_url: "https://example.com/jobs/senior-product-designer",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review job posting",
              description: "Confirm the drafted job before it is added to the jobs board.",
            },
          },
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("Create a new job posting for Acme Corp") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_job_posting"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_job_posting" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "prepare_job_posting");
  assert.match(body, /I drafted the job posting/i);
  assert.match(body, /"type":"pending_action"/);
});

test("create job requests still force prepare_job_posting when the wording includes analytics keywords", async () => {
  const contextModes: Array<string | undefined> = [];

  POST = createChatPostHandler(
    buildDefaultDeps({
      buildPromptContext: async (input: any) => {
        contextModes.push(input.contextMode);
        return {
          systemPrompt: "System prompt",
          orgContextMessage: null,
          metadata: { surface: input.surface, estimatedTokens: 100 },
        };
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_job_posting",
            argsJson:
              '{"title":"Volunteer Fundraising Coordinator","description":"Coordinate fundraising campaigns and donor outreach.","location":"Philadelphia, PA"}',
          };
          return;
        }

        throw new Error("prepare_job_posting should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            title: "Volunteer Fundraising Coordinator",
            description: "Coordinate fundraising campaigns and donor outreach.",
            location: "Philadelphia, PA",
          },
          pending_action: {
            id: "pending-job-analytics-123",
            action_type: "create_job_posting",
            payload: {
              title: "Volunteer Fundraising Coordinator",
              description: "Coordinate fundraising campaigns and donor outreach.",
              location: "Philadelphia, PA",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review job posting",
              description: "Confirm the drafted job before it is added to the jobs board.",
            },
          },
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("Create a job posting for a volunteer fundraising coordinator") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_job_posting"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_job_posting" },
  });
  assert.deepEqual(contextModes, ["full"]);
  assert.equal(executeToolCallCalls[0].call.name, "prepare_job_posting");
  assert.match(body, /I drafted the job posting/i);
  assert.match(body, /"type":"pending_action"/);
});

test("create discussion requests still force prepare_discussion_thread when the wording includes members keywords", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_thread",
            argsJson:
              '{"title":"Alumni Mentorship Volunteers","body":"Let’s coordinate alumni mentors for current members."}',
          };
          return;
        }

        throw new Error("prepare_discussion_thread should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "needs_confirmation",
          draft: {
            title: "Alumni Mentorship Volunteers",
            body: "Let’s coordinate alumni mentors for current members.",
          },
          pending_action: {
            id: "pending-discussion-members-123",
            action_type: "create_discussion_thread",
            payload: {
              title: "Alumni Mentorship Volunteers",
              body: "Let’s coordinate alumni mentors for current members.",
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion thread",
              description: "Confirm the drafted thread before it is posted to discussions.",
            },
          },
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("Create a discussion thread for alumni mentorship volunteers") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_thread"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_thread" },
  });
  assert.equal(executeToolCallCalls[0].call.name, "prepare_discussion_thread");
  assert.match(body, /I drafted the discussion thread/i);
  assert.match(body, /"type":"pending_action"/);
});

test("job draft follow-up keeps prepare_job_posting forced and merges missing details", async () => {
  let draftSession: any = null;

  POST = createChatPostHandler(
    buildDefaultDeps({
      getDraftSession: async () => draftSession,
      saveDraftSession: async (_supabase: unknown, input: any) => {
        draftSession = {
          id: "draft-job-1",
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: input.threadId,
          draft_type: input.draftType,
          status: input.status,
          draft_payload: input.draftPayload,
          missing_fields: input.missingFields,
          pending_action_id: input.pendingActionId ?? null,
          expires_at: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        };
        return draftSession;
      },
      clearDraftSession: async () => {
        draftSession = null;
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_job_posting",
            argsJson: draftSession
              ? '{"location":"Philadelphia, PA","industry":"Sports","application_url":"https://example.com/jobs/volunteer-fundraising"}'
              : '{"title":"Volunteer Fundraising Coordinator","company":"Test Organization","description":"Help lead fundraising efforts."}',
          };
          return;
        }

        throw new Error("prepare_job_posting should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });

        if (!draftSession) {
          return okToolResult({
            state: "missing_fields",
            missing_fields: ["location", "industry", "application_url"],
            draft: {
              title: "Volunteer Fundraising Coordinator",
              company: "Test Organization",
              description: "Help lead fundraising efforts.",
            },
          });
        }

        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-job-continue-123",
            action_type: "create_job_posting",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review job posting",
              description: "Confirm the drafted job before it is added to the jobs board.",
            },
          },
        });
      },
    })
  );

  const firstResponse = await POST(makeRequest("Create a job posting for a volunteer fundraising coordinator") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const firstBody = await firstResponse.text();

  assert.match(firstBody, /I can draft this job, but I still need: location, industry, application_url\./i);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  const followUpRequest = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message:
        "It is in Philadelphia, in the sports industry, and the application URL is https://example.com/jobs/volunteer-fundraising",
      surface: "general",
      threadId: draftSession.thread_id,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
    }),
  });

  const secondResponse = await POST(followUpRequest as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const secondBody = await secondResponse.text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_job_posting"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_job_posting" },
  });
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    title: "Volunteer Fundraising Coordinator",
    company: "Test Organization",
    description: "Help lead fundraising efforts.",
    location: "Philadelphia, PA",
    industry: "Sports",
    application_url: "https://example.com/jobs/volunteer-fundraising",
  });
  assert.match(secondBody, /I drafted the job posting/i);
  assert.match(secondBody, /"type":"pending_action"/);
});

test("discussion draft follow-up keeps prepare_discussion_thread forced and merges missing details", async () => {
  let draftSession: any = null;

  POST = createChatPostHandler(
    buildDefaultDeps({
      getDraftSession: async () => draftSession,
      saveDraftSession: async (_supabase: unknown, input: any) => {
        draftSession = {
          id: "draft-discussion-1",
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: input.threadId,
          draft_type: input.draftType,
          status: input.status,
          draft_payload: input.draftPayload,
          missing_fields: input.missingFields,
          pending_action_id: input.pendingActionId ?? null,
          expires_at: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        };
        return draftSession;
      },
      clearDraftSession: async () => {
        draftSession = null;
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_thread",
            argsJson: draftSession
              ? '{"body":"Let\\u2019s organize volunteer assignments for the fundraiser."}'
              : '{"title":"Spring Volunteer Assignments"}',
          };
          return;
        }

        throw new Error("prepare_discussion_thread should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });

        if (!draftSession) {
          return okToolResult({
            state: "missing_fields",
            missing_fields: ["body"],
            draft: {
              title: "Spring Volunteer Assignments",
            },
          });
        }

        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-discussion-continue-123",
            action_type: "create_discussion_thread",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion thread",
              description: "Confirm the drafted thread before it is posted to discussions.",
            },
          },
        });
      },
    })
  );

  const firstResponse = await POST(makeRequest("Create a discussion thread about spring volunteer assignments") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const firstBody = await firstResponse.text();

  assert.match(firstBody, /I can draft this discussion, but I still need: body\./i);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  const followUpRequest = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Let’s organize volunteer assignments for the fundraiser.",
      surface: "general",
      threadId: draftSession.thread_id,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    }),
  });

  const secondResponse = await POST(followUpRequest as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const secondBody = await secondResponse.text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_thread"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "prepare_discussion_thread" },
  });
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    title: "Spring Volunteer Assignments",
    body: "Let’s organize volunteer assignments for the fundraiser.",
  });
  assert.match(secondBody, /I drafted the discussion thread/i);
  assert.match(secondBody, /"type":"pending_action"/);
});

test("announcement draft follow-up keeps prepare_announcement forced and merges missing details", async () => {
  let draftSession: any = null;

  POST = createChatPostHandler(
    buildDefaultDeps({
      getDraftSession: async () => draftSession,
      saveDraftSession: async (_supabase: unknown, input: any) => {
        draftSession = {
          id: "draft-announcement-1",
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: input.threadId,
          draft_type: input.draftType,
          status: input.status,
          draft_payload: input.draftPayload,
          missing_fields: input.missingFields,
          pending_action_id: input.pendingActionId ?? null,
          expires_at: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        };
        return draftSession;
      },
      clearDraftSession: async () => {
        draftSession = null;
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_announcement",
            argsJson: draftSession
              ? '{"title":"Team Practice","body":"Practice tomorrow at 7am.","audience":"members"}'
              : '{"is_pinned":false,"send_notification":false}',
          };
          return;
        }

        throw new Error("prepare_announcement should not require a second model pass");
      },
      executeToolCall: async (_ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx: _ctx, call });

        if (!draftSession) {
          return okToolResult({
            state: "missing_fields",
            missing_fields: ["title", "body", "audience"],
            draft: {
              is_pinned: false,
              send_notification: false,
            },
          });
        }

        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-announcement-continue-123",
            action_type: "create_announcement",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review announcement",
              description: "Confirm the drafted announcement before it is published.",
            },
          },
        });
      },
    })
  );

  const firstResponse = await POST(makeRequest("Create an announcement about tomorrow's practice") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const firstBody = await firstResponse.text();

  assert.match(firstBody, /I can draft this announcement, but I still need: title, body, audience\./i);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  const followUpRequest = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Title: Team Practice\nBody: Practice tomorrow at 7am.\nAudience: members",
      surface: "general",
      threadId: draftSession.thread_id,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    }),
  });

  const secondResponse = await POST(followUpRequest as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const secondBody = await secondResponse.text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_announcement"]);
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    title: "Team Practice",
    body: "Practice tomorrow at 7am.",
    audience: "members",
    is_pinned: false,
    send_notification: false,
  });
  assert.match(secondBody, /I drafted the announcement/i);
  assert.match(secondBody, /"type":"pending_action"/);
});

test("discussion reply draft follow-up keeps prepare_discussion_reply forced and merges current thread context", async () => {
  let draftSession: any = null;

  POST = createChatPostHandler(
    buildDefaultDeps({
      getDraftSession: async () => draftSession,
      saveDraftSession: async (_supabase: unknown, input: any) => {
        draftSession = {
          id: "draft-reply-1",
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: input.threadId,
          draft_type: input.draftType,
          status: input.status,
          draft_payload: input.draftPayload,
          missing_fields: input.missingFields,
          pending_action_id: input.pendingActionId ?? null,
          expires_at: input.expiresAt ?? "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        };
        return draftSession;
      },
      clearDraftSession: async () => {
        draftSession = null;
      },
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "prepare_discussion_reply",
            argsJson: draftSession
              ? '{"body":"Thanks everyone for the feedback! We\\u2019ll post the final schedule tomorrow."}'
              : "{}",
          };
          return;
        }

        throw new Error("prepare_discussion_reply should not require a second model pass");
      },
      executeToolCall: async (_ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx: _ctx, call });

        if (!draftSession) {
          return okToolResult({
            state: "missing_fields",
            missing_fields: ["body"],
            draft: {
              discussion_thread_id: call.args.discussion_thread_id,
              thread_title: call.args.thread_title,
            },
          });
        }

        return okToolResult({
          state: "needs_confirmation",
          draft: call.args,
          pending_action: {
            id: "pending-reply-continue-123",
            action_type: "create_discussion_reply",
            payload: {
              ...call.args,
              orgSlug: "acme",
            },
            expires_at: "2099-01-01T00:00:00.000Z",
            summary: {
              title: "Review discussion reply",
              description: "Confirm the drafted reply before it is posted to the discussion thread.",
            },
          },
        });
      },
    })
  );

  const firstRequest = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Reply to this thread.",
      surface: "general",
      currentPath: "/acme/messages/threads/33333333-3333-4333-8333-333333333333",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  const firstResponse = await POST(firstRequest as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const firstBody = await firstResponse.text();

  assert.match(firstBody, /I can draft this discussion reply, but I still need: body\./i);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  const followUpRequest = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Thanks everyone for the feedback! We'll post the final schedule tomorrow.",
      surface: "general",
      currentPath: "/acme/messages/threads/33333333-3333-4333-8333-333333333333",
      threadId: draftSession.thread_id,
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
    }),
  });

  const secondResponse = await POST(followUpRequest as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const secondBody = await secondResponse.text();

  assert.deepEqual(toolNamesForCall(0), ["prepare_discussion_reply"]);
  assert.deepEqual(executeToolCallCalls[0].call.args, {
    discussion_thread_id: "33333333-3333-4333-8333-333333333333",
    thread_title: "Spring Fundraising Volunteers",
    body: "Thanks everyone for the feedback! We’ll post the final schedule tomorrow.",
  });
  assert.match(secondBody, /I drafted the discussion reply/i);
  assert.match(secondBody, /"type":"pending_action"/);
});

test("navigation phrasings recognized by the intent router attach find_navigation_targets", async () => {
  await (
    await POST(makeRequest("show me the members page") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["find_navigation_targets"]);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  await (
    await POST(makeRequest("where is navigation settings") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["find_navigation_targets"]);

  composeResponseCalls = [];
  executeToolCallCalls = [];

  await (
    await POST(makeRequest("find the page for announcements") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["find_navigation_targets"]);
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
  assert.equal(
    auditEntries[0].stageTimings.stages.tools.calls[0].auth_mode,
    "reused_verified_admin"
  );
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

test("direct-name connection prompts render resolved suggestions without pass 2", async () => {
  const body = await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Top connections for Louis Ciccone/);
  assert.match(body, /1\. Dina Direct - VP Product • Acme/);
  assert.match(body, /Why: shared company, shared industry/);
  assert.match(body, /"type":"done"/);
});

test("direct-name connection prompts keep deterministic no_suggestions copy", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "no_suggestions",
          mode: "sql_fallback",
          fallback_reason: "disabled",
          freshness: { state: "unknown", as_of: "2026-03-24T00:00:00.000Z" },
          source_person: { name: "Louis Ciccone", subtitle: "Captain • Acme" },
          suggestions: [],
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.match(
    body,
    /there isn't enough strong professional overlap yet to recommend specific connections within the organization/i
  );
  assert.match(body, /"type":"done"/);
});

test("direct-name connection prompts keep the resolved contract for weak fallback matches", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "suggest_connections",
            argsJson: '{"person_query":"Louis Ciccone"}',
          };
          return;
        }
        throw new Error("suggest_connections should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult({
          state: "resolved",
          mode: "sql_fallback",
          fallback_reason: "disabled",
          freshness: { state: "unknown", as_of: "2026-03-24T00:00:00.000Z" },
          source_person: { name: "Louis Ciccone", subtitle: "Captain" },
          suggestions: [
            {
              name: "Dana Coach",
              subtitle: "Advisor",
              reasons: [
                { code: "shared_city", label: "shared city", weight: 4 },
                { code: "graduation_proximity", label: "graduation proximity", weight: 3 },
              ],
            },
          ],
        });
      },
    })
  );

  const body = await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Top connections for Louis Ciccone/);
  assert.match(body, /shared city, graduation proximity/i);
  assert.doesNotMatch(body, /not enough strong professional overlap/i);
});

test("direct-name connection prompts still resolve when pass 2 would have timed out", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "suggest_connections",
            argsJson: '{"person_query":"Louis Ciccone"}',
          };
          return;
        }

        throw new StageTimeoutError("pass2_model", 15_000);
      },
    })
  );

  const body = await (
    await POST(makeRequest("Give me connection for Louis Ciccone") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Top connections for Louis Ciccone/);
  assert.match(body, /Dina Direct/);
  assert.doesNotMatch(body, /The response timed out\. Please try again/);
  assert.match(body, /"type":"done"/);
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

test("single-tool announcement results render deterministic copy without pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_announcements",
            argsJson: '{"limit":5}',
          };
          return;
        }

        throw new Error("list_announcements should not require a second model pass");
      },
    })
  );

  const body = await (
    await POST(makeRequest("Show recent announcements") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Recent announcements/);
  assert.match(body, /Welcome back/);
  assert.match(body, /audience: all/i);
  assert.match(body, /"type":"done"/);
});

test("member pass2 prompt forbids inferred list_members summaries", async () => {
  await (
    await POST(makeRequest("List the first 10 members by name") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.match(
    composeResponseCalls[1].systemPrompt,
    /Only mention members explicitly present in the returned rows\./
  );
  assert.match(
    composeResponseCalls[1].systemPrompt,
    /Do not infer org-wide totals, grouped counts, or role summaries\./
  );
  assert.match(
    composeResponseCalls[1].systemPrompt,
    /showing the first returned members/i
  );
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

test("tool-backed turns fall back when pass 2 emits no content", async () => {
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
        }
      },
    })
  );

  const response = await POST(makeRequest("Give me members and stats") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.match(body, /I didn.t get a usable response for that question/i);
  assert.match(body, /"type":"done"/);
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
        } else {
          options.onUsage?.({ inputTokens: 8, outputTokens: 4 });
          yield { type: "chunk", content: "Here is the combined member and stats summary." };
        }
      },
    })
  );

  const response = await POST(makeRequest("Give me members and stats") as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const body = await response.text();

  assert.doesNotMatch(body, /Let me check/);
  assert.match(body, /combined member and stats summary/);
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
    })
  );

  const response = await POST(makeRequest("Give me members and stats") as any, {
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

test("list_alumni takes the forced tool-first fast path and skips pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_alumni",
            argsJson: '{"limit":5}',
          };
          return;
        }
        throw new Error("list_alumni should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "alumni-1",
            name: "Sarah Chen",
            graduation_year: 2021,
            current_company: "Google",
            current_city: "San Francisco",
            title: "Software Engineer",
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("Who are our alumni?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_alumni"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_alumni" },
  });
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Alumni/);
  assert.match(body, /Sarah Chen/);
  assert.match(body, /class of 2021/);
  assert.match(body, /"type":"done"/);
});

test("list_donations takes the forced tool-first fast path and skips pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_donations",
            argsJson: '{"limit":5}',
          };
          return;
        }
        throw new Error("list_donations should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "donation-1",
            donor_name: "John McKillop",
            amount_dollars: 125.00,
            status: "succeeded",
            created_at: "2026-03-20T12:00:00Z",
            purpose: "Alumni Campaign",
            anonymous: false,
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("What donations have we received?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_donations"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_donations" },
  });
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Donations/);
  assert.match(body, /John McKillop/);
  assert.match(body, /\$125\.00/);
  assert.match(body, /Alumni Campaign/);
  assert.match(body, /"type":"done"/);
});

test("list_parents takes the forced tool-first fast path and skips pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_parents",
            argsJson: '{"limit":5}',
          };
          return;
        }
        throw new Error("list_parents should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "parent-1",
            name: "Margaret Chen",
            relationship: "Mother",
            student_name: "Sarah Chen",
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("Show the parent directory") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_parents"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_parents" },
  });
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Parent directory/);
  assert.match(body, /Margaret Chen/);
  assert.match(body, /student: Sarah Chen/);
  assert.match(body, /"type":"done"/);
});

test("list_philanthropy_events takes the forced tool-first fast path and skips pass 2", async () => {
  POST = createChatPostHandler(
    buildDefaultDeps({
      composeResponse: async function* (options: any) {
        composeResponseCalls.push(options);
        if (options.tools && !options.toolResults) {
          yield {
            type: "tool_call_requested",
            id: "call-1",
            name: "list_philanthropy_events",
            argsJson: '{"limit":5}',
          };
          return;
        }
        throw new Error("list_philanthropy_events should not require a second model pass");
      },
      executeToolCall: async (ctx: any, call: any) => {
        executeToolCallCalls.push({ ctx, call });
        return okToolResult([
          {
            id: "event-1",
            title: "Beach Cleanup",
            start_date: "2026-04-15T09:00:00Z",
            location: "Ocean Beach",
            description: "Annual community beach cleanup.",
          },
        ]);
      },
    })
  );

  const body = await (
    await POST(makeRequest("What volunteer events do we have?") as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.deepEqual(toolNamesForCall(0), ["list_philanthropy_events"]);
  assert.deepEqual(toolChoiceForCall(0), {
    type: "function",
    function: { name: "list_philanthropy_events" },
  });
  assert.equal(composeResponseCalls.length, 1);
  assert.match(body, /Philanthropy events/);
  assert.match(body, /Beach Cleanup/);
  assert.match(body, /Ocean Beach/);
  assert.match(body, /"type":"done"/);
});

test("donor count queries route to get_org_stats, not list_donations", async () => {
  const request = new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How many donors do we have?",
      surface: "general",
      idempotencyKey: VALID_IDEMPOTENCY_KEY,
    }),
  });

  await (
    await POST(request as any, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
  ).text();

  assert.equal(executeToolCallCalls[0].call.name, "get_org_stats");
});
