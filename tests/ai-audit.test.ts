/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("logAiRequest", () => {
  type InsertedAuditRow = Record<string, unknown>;

  function createMockServiceSupabase(opts: {
    shouldError?: boolean;
    enterpriseShouldError?: boolean;
  } = {}) {
    const insertedRows: InsertedAuditRow[] = [];
    const enterpriseRows: InsertedAuditRow[] = [];
    return {
      insertedRows,
      enterpriseRows,
      from: (table: string) => ({
        insert: (row: InsertedAuditRow) => {
          if (table === "enterprise_audit_logs") {
            enterpriseRows.push(row);
            if (opts.enterpriseShouldError) {
              return { error: { message: "Enterprise insert failed" } };
            }
            return { error: null };
          }
          insertedRows.push(row);
          if (opts.shouldError) {
            return { error: { message: "Insert failed" } };
          }
          return { error: null };
        },
        select: () => ({
          // For count query in pruning
          count: async () => ({ count: 0, error: null }),
        }),
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

  it("never throws on insert error", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase({ shouldError: true });
    // Should not throw
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
    });
    // Just verify it didn't throw
    assert.ok(true);
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

  // ── Enterprise scope (Phase 1) ──

  it("writes ai_audit_log row with enterprise_id and null org_id when scope is enterprise", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      scope: { scope: "enterprise", enterpriseId: "ent-1" },
      userEmail: "admin@acme.co",
      toolCalls: [{ name: "get_enterprise_stats", args: {} }],
    });
    assert.equal(mock.insertedRows.length, 1);
    assert.equal(mock.insertedRows[0].enterprise_id, "ent-1");
    assert.equal(mock.insertedRows[0].org_id, null);
  });

  it("dual-writes mirror row to enterprise_audit_logs for enterprise scope", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      scope: { scope: "enterprise", enterpriseId: "ent-1" },
      userEmail: "admin@acme.co",
      toolCalls: [{ name: "get_enterprise_stats", args: { foo: "bar" } }],
    });
    assert.equal(mock.enterpriseRows.length, 1);
    const mirror = mock.enterpriseRows[0];
    assert.equal(mirror.enterprise_id, "ent-1");
    assert.equal(mirror.actor_user_id, "u1");
    assert.equal(mirror.action, "ai.tool_invoked");
    // metadata should include sanitized tool names
    const metadata = mirror.metadata as Record<string, unknown>;
    assert.ok(Array.isArray(metadata?.tools));
  });

  it("does NOT write enterprise_audit_logs row when scope is org", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      orgId: "o1",
      toolCalls: [{ name: "list_members", args: {} }],
    });
    assert.equal(mock.enterpriseRows.length, 0);
    assert.equal(mock.insertedRows.length, 1);
    assert.equal(mock.insertedRows[0].org_id, "o1");
  });

  it("does not throw when enterprise mirror insert fails (best-effort)", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase({ enterpriseShouldError: true });
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      scope: { scope: "enterprise", enterpriseId: "ent-1" },
      userEmail: "admin@acme.co",
    });
    // ai_audit_log should still have a row even though mirror failed
    assert.equal(mock.insertedRows.length, 1);
    assert.equal(mock.insertedRows[0].enterprise_id, "ent-1");
  });

  it("writes no tool_calls in enterprise_audit_logs metadata when none provided", async () => {
    const { logAiRequest } = await import("../src/lib/ai/audit.ts");
    const mock = createMockServiceSupabase();
    await logAiRequest(mock as any, {
      threadId: "t1",
      messageId: "m1",
      userId: "u1",
      scope: { scope: "enterprise", enterpriseId: "ent-1" },
      userEmail: "admin@acme.co",
    });
    assert.equal(mock.enterpriseRows.length, 1);
    const meta = mock.enterpriseRows[0].metadata as Record<string, unknown>;
    assert.ok(Array.isArray(meta?.tools));
    assert.equal((meta.tools as unknown[]).length, 0);
  });
});
