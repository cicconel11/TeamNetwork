import test from "node:test";
import assert from "node:assert/strict";
import { encodeSSE } from "../../../src/lib/ai/sse.ts";
import type { SSEEvent } from "../../../src/lib/ai/sse.ts";

test("encodeSSE serializes tool_status calling event", () => {
  const event: SSEEvent = { type: "tool_status", toolName: "list_members", status: "calling" };
  const encoded = new TextDecoder().decode(encodeSSE(event));
  assert.equal(encoded, 'data: {"type":"tool_status","toolName":"list_members","status":"calling"}\n\n');
});

test("encodeSSE serializes tool_status done event", () => {
  const event: SSEEvent = { type: "tool_status", toolName: "list_members", status: "done" };
  const encoded = new TextDecoder().decode(encodeSSE(event));
  assert.match(encoded, /"status":"done"/);
});

test("encodeSSE serializes tool_status error event", () => {
  const event: SSEEvent = { type: "tool_status", toolName: "get_org_stats", status: "error" };
  const encoded = new TextDecoder().decode(encodeSSE(event));
  assert.match(encoded, /"status":"error"/);
});
