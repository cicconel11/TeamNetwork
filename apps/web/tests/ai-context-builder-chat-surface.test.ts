/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

function createMockServiceSupabase() {
  return {
    from: () => {
      const chain: Record<string, any> = {};
      const methods = ["select", "eq", "is", "gte", "lt", "order", "limit", "in"];
      for (const method of methods) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async () => ({
        data: { name: "Acme", slug: "acme" },
        error: null,
      });
      chain.single = chain.maybeSingle;
      chain.then = (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });
      return chain;
    },
  };
}

describe("buildPromptContext chat-surface policy", () => {
  it("includes CHAT SURFACE POLICY block on /messages route", async () => {
    const { buildPromptContext } = await import(
      "../src/lib/ai/context-builder.ts"
    );
    const result = await buildPromptContext({
      orgId: "o1",
      userId: "u1",
      role: "admin",
      currentPath: "/acme/messages",
      availableTools: ["list_chat_groups", "find_navigation_targets"],
      serviceSupabase: createMockServiceSupabase() as any,
    });

    assert.match(result.systemPrompt, /CHAT SURFACE POLICY:/);
    assert.match(result.systemPrompt, /list_chat_groups with scope: "mine"/);
    assert.match(result.systemPrompt, /list_chat_groups with scope: "all"/);
  });

  it("includes the policy on /chat and /discussions routes", async () => {
    const { buildPromptContext } = await import(
      "../src/lib/ai/context-builder.ts"
    );
    for (const path of ["/acme/chat", "/acme/discussions"]) {
      const result = await buildPromptContext({
        orgId: "o1",
        userId: "u1",
        role: "admin",
        currentPath: path,
        availableTools: ["list_chat_groups"],
        serviceSupabase: createMockServiceSupabase() as any,
      });
      assert.match(result.systemPrompt, /CHAT SURFACE POLICY:/, `path=${path}`);
    }
  });

  it("omits the policy on non-chat routes", async () => {
    const { buildPromptContext } = await import(
      "../src/lib/ai/context-builder.ts"
    );
    const result = await buildPromptContext({
      orgId: "o1",
      userId: "u1",
      role: "admin",
      currentPath: "/acme/announcements",
      availableTools: ["list_announcements"],
      serviceSupabase: createMockServiceSupabase() as any,
    });

    assert.doesNotMatch(result.systemPrompt, /CHAT SURFACE POLICY:/);
  });
});
