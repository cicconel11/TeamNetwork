import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("logAiRequest", () => {
  function createMockServiceSupabase(opts: { shouldError?: boolean } = {}) {
    const insertedRows: any[] = [];
    return {
      insertedRows,
      from: () => ({
        insert: (row: any) => {
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
});
