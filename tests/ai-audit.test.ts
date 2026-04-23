/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("logAiRequest", () => {
  type InsertedAuditRow = Record<string, unknown>;

  function createMockServiceSupabase(opts: { shouldError?: boolean } = {}) {
    const insertedRows: InsertedAuditRow[] = [];
    return {
      insertedRows,
      from: () => ({
        insert: (row: InsertedAuditRow) => {
          insertedRows.push(row);
          if (opts.shouldError) {
            return { error: { message: "Insert failed" } };
          }
          return { error: null };
        },
      }),
    };
  }

  it("inserts an audit row with correct fields", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      intent: "analysis",
      toolCalls: [{ name: "get_members", args: { limit: 10 } }],
      latencyMs: 150,
      model: "grok-3-mini",
      inputTokens: 100,
      outputTokens: 50,
    });
    assert.equal(mock.insertedRows.length, 1);
    assert.equal(mock.insertedRows[0].thread_id, "t1");
    assert.equal(mock.insertedRows[0].intent, "analysis");
    assert.equal(mock.insertedRows[0].latency_ms, 150);
  });

  it("never throws on insert error and fires ops event", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase({ shouldError: true });
    const opsCalls: Array<{ name: string; props: any; orgId: any }> = [];
    const trackOpsEvent = async (name: string, props: any, orgId: any) => {
      opsCalls.push({ name, props, orgId });
    };
    await logAiRequest(
      mock as any,
      {
        threadId: "t1",
        messageId: "m1",
        userId: "u1",
        orgId: "o1",
      },
      undefined,
      { trackOpsEvent: trackOpsEvent as any, sleep: async () => {} }
    );
    assert.equal(opsCalls.length, 1);
    assert.equal(opsCalls[0].name, "api_error");
    assert.equal(opsCalls[0].props.endpoint_group, "ai-audit");
    assert.equal(opsCalls[0].props.error_code, "audit_insert_failed");
    assert.equal(opsCalls[0].orgId, "o1");
  });

  it("redacts sensitive patterns from tool_calls", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      toolCalls: [{ name: "test", args: { token: "sk-abc123xyz", apiKey: "key_secret456", auth: "Bearer eyJhbGciOi" } }],
    });
    const stored = JSON.stringify(mock.insertedRows[0].tool_calls);
    assert.ok(!stored.includes("sk-abc123xyz"), "should redact sk- pattern");
    assert.ok(!stored.includes("key_secret456"), "should redact key_ pattern");
    assert.ok(!stored.includes("Bearer eyJhbGciOi"), "should redact Bearer pattern");
  });

  it("truncates error to 1000 chars", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    const longError = "x".repeat(2000);
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      error: longError,
    });
    assert.equal(mock.insertedRows[0].error.length, 1000);
  });

  it("handles null optional fields gracefully", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: null,
      messageId: null,
      userId: "u1",
      orgId: "o1",
    });
    assert.equal(mock.insertedRows.length, 1);
    assert.equal(mock.insertedRows[0].thread_id, null);
  });

  it("persists cache telemetry fields", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();

    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      cacheStatus: "miss",
      cacheEntryId: "cache-1",
      cacheBypassReason: "unsupported_surface",
    });

    assert.equal(mock.insertedRows[0].cache_status, "miss");
    assert.equal(mock.insertedRows[0].cache_entry_id, "cache-1");
    assert.equal(mock.insertedRows[0].cache_bypass_reason, "unsupported_surface");
  });

  it("persists RAG telemetry fields", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();

    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      ragChunkCount: 3,
      ragTopSimilarity: 0.85,
      ragError: undefined,
    });

    assert.equal(mock.insertedRows[0].rag_chunk_count, 3);
    assert.equal(mock.insertedRows[0].rag_top_similarity, 0.85);
    assert.equal(mock.insertedRows[0].rag_error, null);
  });

  it("persists RAG error when retrieval fails", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();

    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      ragChunkCount: 0,
      ragError: "embedding_api_timeout",
    });

    assert.equal(mock.insertedRows[0].rag_chunk_count, 0);
    assert.equal(mock.insertedRows[0].rag_error, "embedding_api_timeout");
  });

  it("persists stage timing telemetry with redaction", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();

    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      stageTimings: {
        schema_version: 1,
        request: {
          outcome: "completed",
          total_duration_ms: 123,
        },
        retrieval: {
          decision: "skip",
          reason: "tool_only_structured_query",
        },
        stages: {
          auth_org_context: { status: "completed", duration_ms: 1 },
          request_validation_policy: { status: "completed", duration_ms: 2 },
          thread_resolution: { status: "skipped", duration_ms: 0 },
          abandoned_stream_cleanup: { status: "skipped", duration_ms: 0 },
          idempotency_lookup: { status: "completed", duration_ms: 1 },
          init_chat_rpc: { status: "completed", duration_ms: 2 },
          cache_lookup: { status: "skipped", duration_ms: 0 },
          rag_retrieval: { status: "skipped", duration_ms: 0 },
          assistant_placeholder_write: { status: "completed", duration_ms: 1 },
          context_build: { status: "completed", duration_ms: 3 },
          history_load: { status: "completed", duration_ms: 2 },
          pass1_model: { status: "completed", duration_ms: 20 },
          tools: {
            status: "completed",
            duration_ms: 4,
            calls: [
              {
                name: "list_members",
                status: "completed",
                duration_ms: 4,
                auth_mode: "db_lookup",
                error_kind: "Bearer eyJhbGciOi",
              },
            ],
          },
          pass2: { status: "skipped", duration_ms: 0 },
          grounding: { status: "skipped", duration_ms: 0 },
          assistant_finalize_write: { status: "completed", duration_ms: 1 },
          cache_write: { status: "skipped", duration_ms: 0 },
        },
      },
    });

    assert.equal(
      (mock.insertedRows[0].stage_timings as any).request.total_duration_ms,
      123
    );
    const stored = JSON.stringify(mock.insertedRows[0].stage_timings);
    assert.ok(!stored.includes("Bearer eyJhbGciOi"));
    assert.match(stored, /\[REDACTED\]/);
  });
});

describe("logAiRequest retry + ops-event hardening", () => {
  type InsertedAuditRow = Record<string, unknown>;

  function createMock(scriptedErrors: Array<unknown | null>) {
    const insertedRows: InsertedAuditRow[] = [];
    let attempt = 0;
    return {
      insertedRows,
      attempts: () => attempt,
      from: () => ({
        insert: (row: InsertedAuditRow) => {
          insertedRows.push(row);
          const error = scriptedErrors[attempt] ?? null;
          attempt += 1;
          return { error };
        },
      }),
    };
  }

  function makeOpsRecorder() {
    const calls: Array<{ name: string; props: any; orgId: any }> = [];
    const trackOpsEvent = async (name: string, props: any, orgId: any) => {
      calls.push({ name, props, orgId });
    };
    return { calls, trackOpsEvent: trackOpsEvent as any };
  }

  const baseEntry = {
    threadId: "t1",
    messageId: "m1",
    userId: "u1",
    orgId: "o1",
  };

  it("retries once on transient PGRST error and succeeds without ops event", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([{ code: "PGRST001", message: "connection timeout" }, null]);
    const ops = makeOpsRecorder();

    await logAiRequest(mock as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(mock.attempts(), 2);
    assert.equal(ops.calls.length, 0);
  });

  it("fires ops event when transient error persists across retry", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([
      { code: "PGRST001", message: "connection timeout" },
      { code: "PGRST001", message: "still timing out" },
    ]);
    const ops = makeOpsRecorder();

    await logAiRequest(mock as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(mock.attempts(), 2);
    assert.equal(ops.calls.length, 1);
    assert.equal(ops.calls[0].name, "api_error");
    assert.equal(ops.calls[0].props.endpoint_group, "ai-audit");
    assert.equal(ops.calls[0].props.error_code, "audit_insert_failed");
    assert.equal(ops.calls[0].orgId, "o1");
  });

  it("retries on fetch failed network errors", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([{ message: "fetch failed" }, null]);
    const ops = makeOpsRecorder();

    await logAiRequest(mock as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(mock.attempts(), 2);
    assert.equal(ops.calls.length, 0);
  });

  it("does not retry non-transient RLS denial and fires ops event immediately", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([{ code: "42501", message: "permission denied" }]);
    const ops = makeOpsRecorder();

    await logAiRequest(mock as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(mock.attempts(), 1);
    assert.equal(ops.calls.length, 1);
    assert.equal(ops.calls[0].props.error_code, "audit_insert_failed");
  });

  it("does not retry PGRST204 schema-cache mismatch and fires ops event immediately", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([
      {
        code: "PGRST204",
        message: "Could not find the 'rag_grounded' column of 'ai_audit_log'",
      },
    ]);
    const ops = makeOpsRecorder();

    await logAiRequest(mock as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(mock.attempts(), 1, "PGRST204 must not trigger retry");
    assert.equal(ops.calls.length, 1);
    assert.equal(ops.calls[0].props.error_code, "audit_insert_failed");
  });

  it("returns promptly when trackOpsEvent hangs (timeout race)", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMock([{ code: "42501", message: "permission denied" }]);
    const neverResolves = new Promise<void>(() => {});
    const trackOpsEvent = (() => neverResolves) as any;
    // sleep DI lets the 500ms race resolve instantly in tests
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const start = Date.now();
    await logAiRequest(
      mock as any,
      baseEntry,
      undefined,
      { trackOpsEvent, sleep }
    );
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 100, `should not hang; elapsed=${elapsed}ms`);
    assert.ok(sleepCalls.includes(500), "fireOpsEvent should race against 500ms sleep");
  });

  it("fires ops event when serializing throws (outer catch)", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const throwingClient = {
      from: () => {
        throw new Error("supabase-from blew up");
      },
    };
    const ops = makeOpsRecorder();

    await logAiRequest(throwingClient as any, baseEntry, undefined, {
      trackOpsEvent: ops.trackOpsEvent,
      sleep: async () => {},
    });

    assert.equal(ops.calls.length, 1);
    assert.equal(ops.calls[0].props.error_code, "audit_insert_failed");
    assert.equal(ops.calls[0].orgId, "o1");
  });

  it("AI_AUDIT_RETRY_DISABLED skips retry but still fires ops event", async () => {
    const original = process.env.AI_AUDIT_RETRY_DISABLED;
    process.env.AI_AUDIT_RETRY_DISABLED = "1";
    try {
      const { logAiRequest } = await import("../src/lib/ai/audit.ts");
      const mock = createMock([{ code: "PGRST301", message: "transient" }, null]);
      const ops = makeOpsRecorder();

      await logAiRequest(mock as any, baseEntry, undefined, {
        trackOpsEvent: ops.trackOpsEvent,
        sleep: async () => {},
      });

      assert.equal(mock.attempts(), 1);
      assert.equal(ops.calls.length, 1);
      assert.equal(ops.calls[0].props.error_code, "audit_insert_failed");
    } finally {
      if (original === undefined) {
        delete process.env.AI_AUDIT_RETRY_DISABLED;
      } else {
        process.env.AI_AUDIT_RETRY_DISABLED = original;
      }
    }
  });
});
