import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("classifyIntent", () => {
  function createMockClient(response: { intent: string; confidence: number }) {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify(response),
              },
            }],
          }),
        },
      },
    };
  }

  function createErrorClient() {
    return {
      chat: {
        completions: {
          create: async () => { throw new Error("API error"); },
        },
      },
    };
  }

  it("classifies analysis messages", async () => {
    const { classifyIntent } = await import("../src/lib/ai/intent-classifier.ts");
    const mock = createMockClient({ intent: "analysis", confidence: 0.95 });
    const result = await classifyIntent("How many active members do we have?", mock as any);
    assert.equal(result.intent, "analysis");
    assert.equal(result.confidence, 0.95);
  });

  it("classifies general messages", async () => {
    const { classifyIntent } = await import("../src/lib/ai/intent-classifier.ts");
    const mock = createMockClient({ intent: "general", confidence: 0.8 });
    const result = await classifyIntent("Hello, what can you do?", mock as any);
    assert.equal(result.intent, "general");
  });

  it("returns default on API error", async () => {
    const { classifyIntent } = await import("../src/lib/ai/intent-classifier.ts");
    const mock = createErrorClient();
    const result = await classifyIntent("anything", mock as any);
    assert.equal(result.intent, "general");
    assert.equal(result.confidence, 0);
  });

  it("returns default on invalid JSON response", async () => {
    const { classifyIntent } = await import("../src/lib/ai/intent-classifier.ts");
    const mock = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "not json" } }],
          }),
        },
      },
    };
    const result = await classifyIntent("anything", mock as any);
    assert.equal(result.intent, "general");
    assert.equal(result.confidence, 0);
  });
});
