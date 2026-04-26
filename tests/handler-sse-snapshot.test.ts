/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SSE snapshot harness — locks chat handler's streamed bytes against
 * golden fixtures so the upcoming refactor (Plan A U2-U6) is byte-stable.
 *
 * To regenerate fixtures: UPDATE_SNAPSHOTS=1 npm run test:unit (or run this file).
 *
 * Each fixture exercises a distinct terminal branch in handler.ts:
 *   - cache-miss-no-tools      happy pass1+pass2 streaming, no tool calls
 *   - cache-hit                preInit cache hit short-circuit
 *   - scope-refusal            scope_refusal terminal branch
 *
 * Tool-call fixtures (single-tool-call, multi-tool-call) and error-path
 * fixture are seeded as TODO; they require richer composeResponse stubs
 * and land alongside U7/U8 (parallel exec) where they earn coverage.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureSse,
  renderSnapshot,
  readSnapshot,
  writeSnapshot,
  shouldUpdate,
} from "./helpers/sse-capture.ts";

const ORG_ID = "org-uuid-1";
const VALID_IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "org-admin-user", email: "admin@example.com" };

let aiContext: any;
let auditEntries: any[] = [];

function createSupabaseStub() {
  const state = {
    threadCount: 0,
    assistantCount: 0,
    threads: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
  };

  function from(_table: string) {
    const query = {
      op: "select" as "select" | "insert" | "update",
      selectedColumns: null as string | null,
      inserted: null as Record<string, unknown> | null,
      updated: null as Record<string, unknown> | null,
      filters: [] as Array<{ kind: string; column: string; value: unknown }>,
      orderBy: null as { column: string; ascending: boolean } | null,
      limitValue: null as number | null,
    };

    const builder: Record<string, any> = {
      select(columns: string) {
        query.selectedColumns = columns;
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
      // ai_threads insert (resolveOwnThread bypassed via dep stub)
      if (_table === "ai_threads" && query.op === "insert" && query.inserted) {
        const id = `thread-${++state.threadCount}`;
        state.threads.push({ id, ...query.inserted });
        return { data: { id }, error: null };
      }

      if (_table === "ai_messages") {
        if (query.op === "select" &&
            query.filters.some((f) => f.kind === "eq" && f.column === "idempotency_key")) {
          return { data: null, error: null };
        }
        if (query.op === "select") {
          let rows = [...state.messages];
          for (const f of query.filters) {
            if (f.kind === "eq") {
              rows = rows.filter((r) => r[f.column] === f.value);
            }
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
          });
          return { data: null, error: null };
        }
        if (query.op === "update" && query.updated) {
          for (const row of state.messages) {
            const matches = query.filters.every((f) =>
              f.kind === "eq" ? row[f.column] === f.value : true
            );
            if (matches) Object.assign(row, query.updated);
          }
          return { data: null, error: null };
        }
      }

      return { data: null, error: null };
    };

    builder.maybeSingle = async () => resolve();
    builder.single = async () => resolve();
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (r: unknown) => unknown
    ) => Promise.resolve(resolve()).then(onFulfilled, onRejected);

    return builder;
  }

  return {
    auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
    from,
    state,
  };
}

let supabaseStub = createSupabaseStub();
const { createChatPostHandler } = await import("../src/app/api/ai/[orgId]/chat/handler.ts");
let POST = createChatPostHandler();

interface BuildHandlerOpts {
  composeResponse?: any;
  serviceSupabaseRpc?: (fn: string, params: any) => Promise<{ data: any; error: any }>;
  cacheLookupRow?: { id: string; response_content: string; created_at: string } | null;
}

function rebuildHandler(opts: BuildHandlerOpts = {}): void {
  supabaseStub = createSupabaseStub();
  auditEntries = [];

  const cacheLookupRow = opts.cacheLookupRow ?? null;

  const serviceFrom = (table: string) => {
    if (table === "ai_semantic_cache") {
      return {
        select() {
          return {
            eq() { return this; },
            is() { return this; },
            gt() { return this; },
            maybeSingle: async () => ({ data: cacheLookupRow, error: null }),
          };
        },
        update() {
          return {
            eq() { return this; },
            is() { return this; },
            lte: async () => ({ data: null, error: null }),
          };
        },
        insert() {
          return {
            select() { return this; },
            single: async () => ({ data: null, error: null }),
          };
        },
      };
    }
    return supabaseStub.from(table);
  };

  aiContext = {
    ok: true,
    orgId: ORG_ID,
    userId: ADMIN_USER.id,
    role: "admin",
    supabase: supabaseStub,
    serviceSupabase: {
      rpc: opts.serviceSupabaseRpc ?? (async (fn: string, params: any) => {
        if (fn === "init_ai_chat") {
          const threadId = params.p_thread_id ?? `thread-${++supabaseStub.state.threadCount}`;
          if (!supabaseStub.state.threads.some((t) => t.id === threadId)) {
            supabaseStub.state.threads.push({
              id: threadId,
              user_id: params.p_user_id,
              org_id: params.p_org_id,
              surface: params.p_surface,
              title: params.p_title,
            });
          }
          supabaseStub.state.messages.push({
            id: `user-${supabaseStub.state.messages.length + 1}`,
            thread_id: threadId,
            org_id: params.p_org_id,
            user_id: params.p_user_id,
            role: "user",
            content: params.p_message,
            intent: params.p_intent ?? null,
            intent_type: params.p_intent_type ?? null,
            context_surface: params.p_context_surface ?? params.p_surface,
            status: "complete",
            idempotency_key: params.p_idempotency_key,
          });
          return {
            data: {
              thread_id: threadId,
              user_msg_id: `user-${supabaseStub.state.messages.length}`,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      from: serviceFrom,
    },
  };

  const composeResponseDefault = async function* (options: {
    onUsage?: (u: { inputTokens: number; outputTokens: number }) => void;
  }) {
    options.onUsage?.({ inputTokens: 12, outputTokens: 7 });
    yield { type: "chunk", content: "Hello" };
    yield { type: "chunk", content: " world" };
  };

  POST = createChatPostHandler({
    createClient: async () => supabaseStub as any,
    getAiOrgContext: async () => aiContext,
    buildPromptContext: async (input: any) => ({
      systemPrompt: "System prompt",
      orgContextMessage: null,
      metadata: { surface: input.surface, estimatedTokens: 100 },
    }),
    createZaiClient: () => ({ client: "fake" } as any),
    getZaiModel: () => "glm-5",
    composeResponse: opts.composeResponse ?? composeResponseDefault,
    logAiRequest: async (_s: unknown, entry: unknown) => {
      auditEntries.push(entry);
    },
    retrieveRelevantChunks: async () => [],
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
    trackOpsEventServer: async () => {},
  });
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/ai/${ORG_ID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function runFixture(
  name: string,
  build: () => void,
  request: () => Request,
): Promise<void> {
  build();
  const response = await POST(request() as any, {
    params: Promise.resolve({ orgId: ORG_ID }),
  });
  const captured = await captureSse(response as Response);
  const rendered = renderSnapshot(captured);

  if (shouldUpdate()) {
    writeSnapshot(name, rendered);
    return;
  }

  const golden = readSnapshot(name);
  if (golden === null) {
    assert.fail(
      `Missing SSE snapshot "${name}". Run UPDATE_SNAPSHOTS=1 to create it.`,
    );
  }

  assert.equal(rendered, golden, `SSE snapshot drift in fixture "${name}"`);
}

beforeEach(() => {
  (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore?.clear();
  process.env.ZAI_API_KEY = "test-key";
  process.env.DISABLE_AI_CACHE = "true";
  delete process.env.EMBEDDING_API_KEY;
});

test("snapshot: cache-miss-no-tools (happy pass1+pass2 stream)", async () => {
  await runFixture(
    "cache-miss-no-tools",
    () => rebuildHandler(),
    () =>
      // ambiguous_query keeps effectiveSurface=general; cache disabled
      // via DISABLE_AI_CACHE so we exercise the streaming branch cleanly.
      makeRequest({
        message: "Compare members, donations, and events",
        surface: "general",
        idempotencyKey: VALID_IDEMPOTENCY_KEY,
      }),
  );
});

test("snapshot: cache-hit (preInit lookup short-circuit)", async () => {
  await runFixture(
    "cache-hit",
    () =>
      rebuildHandler({
        cacheLookupRow: {
          id: "cache-entry-1",
          response_content: "Cached reply.",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      }),
    () => {
      // static_general profile + cachePolicy=lookup_exact + cache-eligible.
      delete process.env.DISABLE_AI_CACHE;
      process.env.EMBEDDING_API_KEY = "embed-key";
      return makeRequest({
        message: "Explain what teamnetwork is",
        surface: "general",
        idempotencyKey: VALID_IDEMPOTENCY_KEY,
      });
    },
  );
});

test("snapshot: scope-refusal (out_of_scope_unrelated terminal)", async () => {
  await runFixture(
    "scope-refusal",
    () => rebuildHandler(),
    () =>
      makeRequest({
        message: "What's the weather in Paris tomorrow?",
        surface: "general",
        idempotencyKey: VALID_IDEMPOTENCY_KEY,
      }),
  );
});
