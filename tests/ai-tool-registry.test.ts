import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createToolRegistry,
  type AiTool,
  type AiToolContext,
  type AiToolResult,
} from "../src/lib/ai/tool-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<AiToolContext> = {}): AiToolContext {
  return {
    orgId: "org-abc",
    userId: "user-xyz",
    serviceSupabase: {} as AiToolContext["serviceSupabase"],
    ...overrides,
  };
}

function makeTool(overrides: Partial<AiTool> = {}): AiTool {
  return {
    name: "get_members",
    description: "Fetches member list for the current org",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
      required: [],
    },
    execute: async (_args, ctx) => ({
      data: [{ org_id: ctx.orgId, name: "Alice" }],
      prose: "Found 1 member",
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createToolRegistry", () => {
  it("registers a tool and retrieves it by name", () => {
    const registry = createToolRegistry();
    const tool = makeTool();
    registry.register(tool);

    const found = registry.get("get_members");
    assert.ok(found !== null, "should find registered tool");
    assert.equal(found!.name, "get_members");
    assert.equal(found!.description, "Fetches member list for the current org");
  });

  it("returns null for an unknown tool name", () => {
    const registry = createToolRegistry();
    const result = registry.get("nonexistent_tool");
    assert.equal(result, null);
  });

  it("lists all registered tools", () => {
    const registry = createToolRegistry();
    const tool1 = makeTool({ name: "tool_a" });
    const tool2 = makeTool({ name: "tool_b" });
    registry.register(tool1);
    registry.register(tool2);

    const all = registry.list();
    assert.equal(all.length, 2);
    const names = all.map((t) => t.name);
    assert.ok(names.includes("tool_a"));
    assert.ok(names.includes("tool_b"));
  });

  it("returns empty array when no tools registered", () => {
    const registry = createToolRegistry();
    assert.deepEqual(registry.list(), []);
  });

  it("overwrites a tool when registered under the same name", () => {
    const registry = createToolRegistry();
    registry.register(makeTool({ description: "original" }));
    registry.register(makeTool({ description: "updated" }));

    const found = registry.get("get_members");
    assert.equal(found!.description, "updated");
    assert.equal(registry.list().length, 1);
  });

  describe("execute", () => {
    it("executes a registered tool with context and returns result", async () => {
      const registry = createToolRegistry();
      registry.register(makeTool());

      const ctx = makeContext({ orgId: "org-abc" });
      const result = await registry.execute("get_members", { limit: 10 }, ctx);

      assert.equal(result.error, undefined);
      assert.deepEqual(result.data, [{ org_id: "org-abc", name: "Alice" }]);
      assert.equal(result.prose, "Found 1 member");
    });

    it("returns error result for unknown tool", async () => {
      const registry = createToolRegistry();
      const ctx = makeContext();

      const result = await registry.execute("unknown_tool", {}, ctx);

      assert.ok(typeof result.error === "string", "should return an error string");
      assert.ok(result.error!.includes("unknown_tool"), "error should mention the tool name");
      assert.equal(result.data, null);
    });

    it("passes args through to the tool execute function", async () => {
      const registry = createToolRegistry();
      let capturedArgs: Record<string, unknown> | null = null;

      registry.register(
        makeTool({
          name: "capture_args",
          execute: async (args) => {
            capturedArgs = args;
            return { data: null };
          },
        })
      );

      await registry.execute("capture_args", { foo: "bar", count: 42 }, makeContext());

      assert.deepEqual(capturedArgs, { foo: "bar", count: 42 });
    });

    it("passes context (orgId, userId) to tool execute", async () => {
      const registry = createToolRegistry();
      let capturedCtx: AiToolContext | null = null;

      registry.register(
        makeTool({
          name: "capture_ctx",
          execute: async (_args, ctx) => {
            capturedCtx = ctx;
            return { data: null };
          },
        })
      );

      const ctx = makeContext({ orgId: "org-111", userId: "user-222" });
      await registry.execute("capture_ctx", {}, ctx);

      assert.ok(capturedCtx !== null);
      assert.equal(capturedCtx!.orgId, "org-111");
      assert.equal(capturedCtx!.userId, "user-222");
    });

    it("propagates errors thrown by the tool execute function", async () => {
      const registry = createToolRegistry();
      registry.register(
        makeTool({
          name: "failing_tool",
          execute: async () => {
            throw new Error("Database exploded");
          },
        })
      );

      await assert.rejects(
        () => registry.execute("failing_tool", {}, makeContext()),
        { message: "Database exploded" }
      );
    });
  });

  describe("toFunctionDefinitions", () => {
    it("returns OpenAI-compatible function definitions", () => {
      const registry = createToolRegistry();
      registry.register(makeTool());

      const defs = registry.toFunctionDefinitions();
      assert.equal(defs.length, 1);

      const def = defs[0];
      assert.equal(def.name, "get_members");
      assert.equal(def.description, "Fetches member list for the current org");
      assert.deepEqual(def.parameters, {
        type: "object",
        properties: { limit: { type: "number" } },
        required: [],
      });
    });

    it("does NOT include the execute function in definitions", () => {
      const registry = createToolRegistry();
      registry.register(makeTool());

      const defs = registry.toFunctionDefinitions();
      const def = defs[0] as Record<string, unknown>;
      assert.equal(def.execute, undefined, "execute should be excluded from function definitions");
    });

    it("returns empty array when no tools registered", () => {
      const registry = createToolRegistry();
      assert.deepEqual(registry.toFunctionDefinitions(), []);
    });

    it("returns definitions for all registered tools", () => {
      const registry = createToolRegistry();
      registry.register(makeTool({ name: "tool_a" }));
      registry.register(makeTool({ name: "tool_b" }));
      registry.register(makeTool({ name: "tool_c" }));

      const defs = registry.toFunctionDefinitions();
      assert.equal(defs.length, 3);
      const names = defs.map((d) => d.name);
      assert.ok(names.includes("tool_a"));
      assert.ok(names.includes("tool_b"));
      assert.ok(names.includes("tool_c"));
    });
  });

  describe("cross-org isolation (scoping contract)", () => {
    it("context orgId is passed to tool — tool is responsible for filtering by orgId", async () => {
      const registry = createToolRegistry();
      const seenOrgIds: string[] = [];

      // Simulate a tool that correctly filters by orgId
      registry.register(
        makeTool({
          name: "scoped_tool",
          execute: async (_args, ctx) => {
            seenOrgIds.push(ctx.orgId);
            // Contract: the tool MUST use ctx.orgId in its query.
            // Here we verify the registry passes the right orgId.
            return { data: { filtered_for: ctx.orgId } };
          },
        })
      );

      const ctxOrg1 = makeContext({ orgId: "org-1" });
      const ctxOrg2 = makeContext({ orgId: "org-2" });

      const result1 = await registry.execute("scoped_tool", {}, ctxOrg1);
      const result2 = await registry.execute("scoped_tool", {}, ctxOrg2);

      // Each invocation receives the correct orgId — org-2 cannot see org-1 data
      assert.deepEqual(result1.data, { filtered_for: "org-1" });
      assert.deepEqual(result2.data, { filtered_for: "org-2" });

      // Both calls ran with distinct orgIds
      assert.deepEqual(seenOrgIds, ["org-1", "org-2"]);
    });

    it("a tool receiving the wrong orgId would return wrong-org data (demonstrates why tools must filter)", async () => {
      // This test is a canary: if the registry ever mutates/shares ctx,
      // the isolation contract is broken.
      const registry = createToolRegistry();

      registry.register(
        makeTool({
          name: "data_tool",
          execute: async (_args, ctx) => ({
            data: { org: ctx.orgId },
          }),
        })
      );

      const result = await registry.execute("data_tool", {}, makeContext({ orgId: "org-secret" }));
      // The tool received org-secret — never a different org's id
      assert.deepEqual((result.data as { org: string }).org, "org-secret");
    });
  });

  describe("AiToolResult shape", () => {
    it("result with only data (no prose, no error) is valid", async () => {
      const registry = createToolRegistry();
      registry.register(
        makeTool({
          execute: async () => ({ data: { count: 5 } }),
        })
      );

      const result: AiToolResult = await registry.execute("get_members", {}, makeContext());
      assert.deepEqual(result.data, { count: 5 });
      assert.equal(result.prose, undefined);
      assert.equal(result.error, undefined);
    });

    it("result with prose is surfaced correctly", async () => {
      const registry = createToolRegistry();
      registry.register(
        makeTool({
          execute: async () => ({ data: null, prose: "No members found" }),
        })
      );

      const result = await registry.execute("get_members", {}, makeContext());
      assert.equal(result.prose, "No members found");
    });
  });
});
