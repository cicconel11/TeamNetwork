import test from "node:test";
import assert from "node:assert/strict";
import { AI_TOOLS, TOOL_NAMES } from "../../../src/lib/ai/tools/definitions.ts";
import type { ToolName } from "../../../src/lib/ai/tools/definitions.ts";

type ToolProperties = Record<string, { type?: string; maximum?: number }>;
type ToolParameters = { properties?: ToolProperties; additionalProperties?: boolean; required?: string[] };

test("AI_TOOLS exports 8 tool definitions", () => {
  assert.equal(AI_TOOLS.length, 8);
});

test("every tool has type function and additionalProperties false", () => {
  for (const tool of AI_TOOLS) {
    assert.equal(tool.type, "function");
    assert.ok(tool.function.name);
    assert.ok(tool.function.description);
    const params = tool.function.parameters as Record<string, unknown>;
    assert.equal(params.additionalProperties, false);
  }
});

test("TOOL_NAMES contains all 8 names", () => {
  const expected: ToolName[] = [
    "list_members",
    "list_events",
    "list_announcements",
    "list_discussions",
    "list_job_postings",
    "get_org_stats",
    "suggest_connections",
    "find_navigation_targets",
  ];
  assert.deepEqual([...TOOL_NAMES].sort(), [...expected].sort());
});

test("ToolName type is derived from AI_TOOLS", () => {
  // If ToolName is properly derived, this assignment should work at compile time.
  // At runtime, verify the set matches the tools array.
  const namesFromArray = AI_TOOLS.map(t => t.function.name);
  assert.deepEqual([...TOOL_NAMES].sort(), [...namesFromArray].sort());
});

test("list_members has limit parameter but no status parameter", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "list_members")!;
  const params = tool.function.parameters as ToolParameters;
  const props = params.properties as ToolProperties;
  assert.ok(props.limit);
  assert.equal(props.limit.type, "integer");
  assert.equal(props.limit.maximum, 50);
  assert.match(tool.function.description, /best available human name/i);
  assert.match(tool.function.description, /email-only member or admin account/i);
  // Amendment #2: No status filter — alumni/parents are separate tables
  assert.equal(props.status, undefined);
});

test("list_events has limit and upcoming parameters", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "list_events")!;
  const params = tool.function.parameters as ToolParameters;
  const props = params.properties as ToolProperties;
  assert.ok(props.limit);
  assert.equal(props.limit.maximum, 25);
  assert.ok(props.upcoming);
  assert.equal(props.upcoming.type, "boolean");
});

test("list_announcements has a limit parameter", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "list_announcements")!;
  const params = tool.function.parameters as ToolParameters;
  const props = params.properties as ToolProperties;
  assert.ok(props.limit);
  assert.equal(props.limit.maximum, 25);
});

test("get_org_stats has no required parameters", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "get_org_stats")!;
  const params = tool.function.parameters as ToolParameters;
  assert.equal(params.required, undefined);
});

test("suggest_connections supports person_query or person_type plus person_id", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "suggest_connections")!;
  const params = tool.function.parameters as ToolParameters;
  const props = params.properties as ToolProperties;

  assert.ok(props.person_type);
  assert.ok(props.person_id);
  assert.ok(props.person_query);
  assert.equal(props.limit.maximum, 25);
  assert.equal(params.required, undefined);
});

test("find_navigation_targets requires a query string", () => {
  const tool = AI_TOOLS.find((t) => t.function.name === "find_navigation_targets")!;
  const params = tool.function.parameters as ToolParameters;
  const props = params.properties as ToolProperties;

  assert.ok(props.query);
  assert.equal(props.query.type, "string");
  assert.equal(props.limit.maximum, 10);
  assert.deepEqual(params.required, ["query"]);
});
