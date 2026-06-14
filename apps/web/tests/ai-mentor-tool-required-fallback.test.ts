import test from "node:test";
import assert from "node:assert/strict";

import { MENTOR_TOOL_REQUIRED_FALLBACK } from "../src/app/api/ai/[orgId]/chat/handler/sse-runtime.ts";

test("mentor tool-required fallback offers person and criteria examples", () => {
  assert.ok(!MENTOR_TOOL_REQUIRED_FALLBACK.includes("<member name>"));
  assert.match(MENTOR_TOOL_REQUIRED_FALLBACK, /Jane Smith/);
  assert.match(MENTOR_TOOL_REQUIRED_FALLBACK, /marketing/);
});
