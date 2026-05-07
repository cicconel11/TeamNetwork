import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AI_TOOL_MAP, type ToolName } from "../src/lib/ai/tools/definitions";
import { classifyFastPath, type FastPathReason } from "../src/app/api/ai/[orgId]/chat/handler/fast-path-classifier";
import type { TurnExecutionPolicy } from "../src/lib/ai/turn-execution-policy";

const SURFACE_READ_POLICY: { toolPolicy: TurnExecutionPolicy["toolPolicy"] } = {
  toolPolicy: "surface_read_tools",
};

const REASON_VALUES = [
  "pending_disambiguation",
  "pending_revision",
  "draft_active",
  "attachment_present",
  "multi_tool",
  "bypass_disabled",
  "bypass_shadow",
  "forced_single_tool",
  "tool_first_eligible",
] as const satisfies readonly FastPathReason[];

function singleTool(name: ToolName) {
  return [AI_TOOL_MAP[name]];
}

function forcedChoice(name: ToolName) {
  return {
    type: "function" as const,
    function: { name },
  };
}

function base(overrides: Partial<Parameters<typeof classifyFastPath>[0]> = {}) {
  return {
    executionPolicy: SURFACE_READ_POLICY,
    pass1Tools: singleTool("list_members"),
    pass1ToolChoice: forcedChoice("list_members"),
    activeDraftSession: null,
    pendingEventRevisionAnalysis: { kind: "none" },
    pendingConnectionDisambiguation: false,
    attachment: undefined,
    retrievalReason: "tool_only_structured_query",
    usesSharedStaticContext: false,
    pass1BypassMode: "on" as const,
    ...overrides,
  };
}

describe("classifyFastPath", () => {
  it("keeps the reason union stable", () => {
    assert.deepEqual(REASON_VALUES, [
      "pending_disambiguation",
      "pending_revision",
      "draft_active",
      "attachment_present",
      "multi_tool",
      "bypass_disabled",
      "bypass_shadow",
      "forced_single_tool",
      "tool_first_eligible",
    ]);
  });

  it("classifies bypass off/on/shadow without changing compatible pass1_path values", () => {
    const off = classifyFastPath(base({ pass1BypassMode: "off" }));
    assert.equal(off.canBypassPass1, true);
    assert.equal(off.fastPathLabel, "bypass_disabled");
    assert.equal(off.pass1Path, "model");

    const shadow = classifyFastPath(base({ pass1BypassMode: "shadow" }));
    assert.equal(shadow.canBypassPass1, true);
    assert.equal(shadow.fastPathLabel, "bypass_shadow");
    assert.equal(shadow.pass1Path, "model_shadow_bypass_eligible");

    const on = classifyFastPath(base({ pass1BypassMode: "on" }));
    assert.equal(on.canBypassPass1, true);
    assert.equal(on.fastPathLabel, "pass1_bypass_eligible");
    assert.equal(on.pass1Path, undefined);
  });

  it("applies suppressor precedence before enablers", () => {
    const out = classifyFastPath(base({
      pendingConnectionDisambiguation: true,
      pendingEventRevisionAnalysis: { kind: "clarify" },
      activeDraftSession: { id: "draft" },
      attachment: { fileName: "x.pdf" },
      pass1Tools: [AI_TOOL_MAP.list_members, AI_TOOL_MAP.list_events],
      pass1BypassMode: "shadow",
    }));

    assert.equal(out.fastPathLabel, "pending_disambiguation");
    assert.deepEqual(out.reasons, ["pending_disambiguation"]);
    assert.equal(out.canBypassPass1, false);
    assert.equal(out.pass1Path, "model");
  });

  it("classifies each suppressor", () => {
    assert.equal(
      classifyFastPath(base({ pendingEventRevisionAnalysis: { kind: "clarify" } })).fastPathLabel,
      "pending_revision",
    );
    assert.equal(
      classifyFastPath(base({ activeDraftSession: { id: "draft" } })).fastPathLabel,
      "draft_active",
    );
    assert.equal(
      classifyFastPath(base({ attachment: { fileName: "x.pdf" } })).fastPathLabel,
      "attachment_present",
    );
    assert.equal(
      classifyFastPath(base({ pass1Tools: [AI_TOOL_MAP.list_members, AI_TOOL_MAP.list_events] })).fastPathLabel,
      "multi_tool",
    );
  });

  it("classifies forced single tool that is not bypass eligible", () => {
    const out = classifyFastPath(base({
      pass1Tools: singleTool("suggest_connections"),
      pass1ToolChoice: forcedChoice("suggest_connections"),
    }));

    assert.equal(out.fastPathLabel, "forced_single_tool");
    assert.equal(out.canBypassPass1, false);
    assert.equal(out.forcedSingleToolName, "suggest_connections");
  });

  it("classifies tool-first context eligibility independently from bypass", () => {
    const out = classifyFastPath(base({
      pass1Tools: singleTool("suggest_connections"),
      pass1ToolChoice: undefined,
      executionPolicy: { toolPolicy: "none" },
    }));

    assert.equal(out.fastPathLabel, "tool_first_eligible");
    assert.equal(out.usesToolFirstContext, true);
    assert.equal(out.canBypassPass1, false);
  });

  it("does not use tool-first context for shared static or non-tool retrieval", () => {
    assert.equal(
      classifyFastPath(base({
        pass1Tools: singleTool("suggest_connections"),
        pass1ToolChoice: undefined,
        usesSharedStaticContext: true,
      })).usesToolFirstContext,
      false,
    );
    assert.equal(
      classifyFastPath(base({
        pass1Tools: singleTool("suggest_connections"),
        pass1ToolChoice: undefined,
        retrievalReason: "general_knowledge_query",
      })).usesToolFirstContext,
      false,
    );
  });

  it("records shadow-mode parity metadata without selecting the bypass runtime path", () => {
    const out = classifyFastPath(base({ pass1BypassMode: "shadow" }));
    assert.equal(out.fastPathLabel, "bypass_shadow");
    assert.equal(out.canBypassPass1, true);
    assert.equal(out.forcedSingleToolName, "list_members");
    assert.equal(out.pass1Path, "model_shadow_bypass_eligible");
    assert.deepEqual(out.reasons, ["bypass_shadow"]);
  });
});
