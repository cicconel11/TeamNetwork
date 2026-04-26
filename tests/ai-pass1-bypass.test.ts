import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_TOOL_MAP,
  type ToolName,
} from "../src/lib/ai/tools/definitions";
import {
  BYPASS_ELIGIBLE_TOOLS,
  canBypassPass1,
  getForcedPass1ToolChoice,
} from "../src/app/api/ai/[orgId]/chat/handler/pass1-tools";
import type { TurnExecutionPolicy } from "../src/lib/ai/turn-execution-policy";

const SURFACE_READ_POLICY: { toolPolicy: TurnExecutionPolicy["toolPolicy"] } = {
  toolPolicy: "surface_read_tools",
};

function singleTool(name: ToolName) {
  return [AI_TOOL_MAP[name]];
}

function happy(name: ToolName) {
  return {
    pass1Tools: singleTool(name),
    pass1ToolChoice: {
      type: "function" as const,
      function: { name },
    },
    activeDraftSession: null,
    pendingEventRevisionAnalysis: { kind: "none" as const },
    pendingConnectionDisambiguation: false,
    attachment: undefined,
    executionPolicy: SURFACE_READ_POLICY,
  };
}

describe("BYPASS_ELIGIBLE_TOOLS ⊂ getForcedPass1ToolChoice allowlist", () => {
  for (const toolName of BYPASS_ELIGIBLE_TOOLS) {
    it(`${toolName} resolves to a forced tool choice`, () => {
      const choice = getForcedPass1ToolChoice(singleTool(toolName));
      assert.ok(choice, `expected ${toolName} forced`);
      assert.equal(choice?.type, "function");
      if (choice?.type === "function") {
        assert.equal(choice.function.name, toolName);
      }
    });
  }
});

describe("canBypassPass1 — happy path per eligible tool", () => {
  for (const toolName of BYPASS_ELIGIBLE_TOOLS) {
    it(`${toolName} → true`, () => {
      assert.equal(canBypassPass1(happy(toolName)), true);
    });
  }
});

describe("canBypassPass1 — suppressors", () => {
  it("multi-tool pass1Tools → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({
        ...input,
        pass1Tools: [AI_TOOL_MAP.list_members, AI_TOOL_MAP.list_alumni],
      }),
      false,
    );
  });

  it("missing pass1ToolChoice → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({ ...input, pass1ToolChoice: undefined }),
      false,
    );
  });

  it("toolPolicy != surface_read_tools → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({
        ...input,
        executionPolicy: { toolPolicy: "none" },
      }),
      false,
    );
  });

  it("activeDraftSession present → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({
        ...input,
        activeDraftSession: { id: "draft" } as unknown,
      }),
      false,
    );
  });

  it("pendingEventRevisionAnalysis kind != none → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({
        ...input,
        pendingEventRevisionAnalysis: {
          kind: "clarify",
        },
      }),
      false,
    );
  });

  it("pendingConnectionDisambiguation → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({ ...input, pendingConnectionDisambiguation: true }),
      false,
    );
  });

  it("attachment present → false", () => {
    const input = happy("list_members");
    assert.equal(
      canBypassPass1({
        ...input,
        attachment: {
          fileName: "x.pdf",
          mimeType: "application/pdf",
          storagePath: "p/x",
          sizeBytes: 1,
        } as never,
      }),
      false,
    );
  });

  it("non-eligible tool (suggest_connections) → false", () => {
    assert.equal(
      canBypassPass1({
        pass1Tools: [AI_TOOL_MAP.suggest_connections],
        pass1ToolChoice: {
          type: "function",
          function: { name: "suggest_connections" },
        },
        activeDraftSession: null,
        pendingEventRevisionAnalysis: { kind: "none" },
        pendingConnectionDisambiguation: false,
        attachment: undefined,
        executionPolicy: SURFACE_READ_POLICY,
      }),
      false,
    );
  });
});
