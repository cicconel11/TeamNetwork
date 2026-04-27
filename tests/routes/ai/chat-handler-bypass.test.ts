/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runPass1Bypass,
  type RunPass1BypassInput,
} from "../../../src/app/api/ai/[orgId]/chat/handler/stages/run-pass1-bypass";
import {
  createStageTimings,
  type AiAuditStageTimings,
} from "../../../src/lib/ai/chat-telemetry";
import type { ToolCallRequestedEvent } from "../../../src/lib/ai/response-composer";

function buildInput(
  toolName: string,
  message: string,
  capture: { events: ToolCallRequestedEvent[] },
  callOutcome: "continue" | "stop" = "continue",
): RunPass1BypassInput {
  return {
    toolName,
    message,
    requestId: "req-test-1",
    stageTimings: createStageTimings("req-test-1"),
    onToolCall: async (event) => {
      capture.events.push(event);
      return callOutcome;
    },
  };
}

describe("runPass1Bypass — synthetic tool call", () => {
  it("derived args path: get_donation_analytics 'trends by month' → bypass_derived", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput(
      "get_donation_analytics",
      "show me donation trends by month",
      capture,
    );
    const outcome = await runPass1Bypass(input);

    assert.equal(outcome.pass1Path, "bypass_derived");
    assert.equal(outcome.callOutcome, "continue");
    assert.equal(capture.events.length, 1);
    assert.equal(capture.events[0].name, "get_donation_analytics");
    assert.equal(capture.events[0].id, "bypass-call-req-test-1");
    assert.deepEqual(JSON.parse(capture.events[0].argsJson), {
      dimension: "trend",
    });
    assert.equal(input.stageTimings.request.pass1_path, "bypass_derived");
    assert.equal(input.stageTimings.stages.pass1_model.status, "skipped");
  });

  it("zero-arg path: list_members → bypass_zero_arg", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput("list_members", "list our members", capture);
    const outcome = await runPass1Bypass(input);

    assert.equal(outcome.pass1Path, "bypass_zero_arg");
    assert.deepEqual(JSON.parse(capture.events[0].argsJson), {});
    assert.equal(input.stageTimings.request.pass1_path, "bypass_zero_arg");
  });

  it("get_org_stats with donor keyword → derived scope=donations", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput(
      "get_org_stats",
      "how many donors have we had?",
      capture,
    );
    await runPass1Bypass(input);
    assert.deepEqual(JSON.parse(capture.events[0].argsJson), {
      scope: "donations",
    });
  });

  it("find_navigation_targets strips navigation phrasing", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput(
      "find_navigation_targets",
      "open announcements",
      capture,
    );
    await runPass1Bypass(input);
    assert.deepEqual(JSON.parse(capture.events[0].argsJson), {
      query: "announcements",
    });
  });

  it("search_org_content strips content-search phrasing", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput(
      "search_org_content",
      "search announcements about fundraising",
      capture,
    );
    await runPass1Bypass(input);
    assert.deepEqual(JSON.parse(capture.events[0].argsJson), {
      query: "fundraising",
    });
  });

  it("synthetic id round-trips on the emitted event", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput("list_alumni", "who are our alumni?", capture);
    await runPass1Bypass(input);
    assert.match(capture.events[0].id, /^bypass-call-/);
  });

  it("returns stop when onToolCall stops (forbidden/auth) without throwing", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput(
      "list_donations",
      "list donations",
      capture,
      "stop",
    );
    const outcome = await runPass1Bypass(input);
    assert.equal(outcome.callOutcome, "stop");
  });
});

describe("runPass1Bypass — telemetry shape additivity", () => {
  it("does not bump schema_version when adding pass1_path", async () => {
    const capture = { events: [] as ToolCallRequestedEvent[] };
    const input = buildInput("list_events", "show events", capture);
    await runPass1Bypass(input);
    const timings: AiAuditStageTimings = input.stageTimings;
    assert.equal(timings.schema_version, 1);
    assert.ok(timings.request.pass1_path);
  });
});
