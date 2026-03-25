import test from "node:test";
import assert from "node:assert/strict";
import { resolveSurfaceRouting } from "../src/lib/ai/intent-router.ts";
import { checkCacheEligibility } from "../src/lib/ai/semantic-cache-utils.ts";
import { buildTurnExecutionPolicy } from "../src/lib/ai/turn-execution-policy.ts";

function buildPolicy(message: string, surface: "general" | "members" | "analytics" | "events", threadId?: string) {
  const routing = resolveSurfaceRouting(message, surface);
  const cacheEligibility = checkCacheEligibility({
    message,
    surface: routing.effectiveSurface,
    threadId,
  });

  return buildTurnExecutionPolicy({
    message,
    threadId,
    requestedSurface: surface,
    routing,
    cacheEligibility,
  });
}

test("buildTurnExecutionPolicy marks thread replies as follow_up", () => {
  const policy = buildPolicy("Explain the organization history", "general", "thread-1");

  assert.equal(policy.profile, "follow_up");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "surface_read_tools");
  assert.equal(policy.retrieval.mode, "allow");
  assert.equal(policy.retrieval.reason, "follow_up_requires_context");
});

test("buildTurnExecutionPolicy marks casual turns as non-cacheable", () => {
  const policy = buildPolicy("Thanks!", "general");

  assert.equal(policy.profile, "casual");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "none");
  assert.equal(policy.retrieval.mode, "skip");
  assert.equal(policy.retrieval.reason, "casual_turn");
});

test("buildTurnExecutionPolicy preserves cacheable first-turn general explainers", () => {
  const policy = buildPolicy("Explain the organization history", "general");

  assert.equal(policy.profile, "static_general");
  assert.equal(policy.cachePolicy, "lookup_exact");
  assert.equal(policy.contextPolicy, "shared_static");
  assert.equal(policy.toolPolicy, "none");
});

test("buildTurnExecutionPolicy keeps live org questions on the live_lookup path", () => {
  const policy = buildPolicy("How many members do we have?", "general");

  assert.equal(policy.profile, "live_lookup");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "surface_read_tools");
  assert.equal(policy.retrieval.mode, "skip");
  assert.equal(policy.retrieval.reason, "tool_only_structured_query");
});

test("buildTurnExecutionPolicy keeps governance-doc requests narrowly out_of_scope", () => {
  const policy = buildPolicy("Explain the organization bylaws", "general");

  assert.equal(policy.profile, "out_of_scope");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "none");
  assert.equal(policy.retrieval.mode, "skip");
  assert.equal(policy.retrieval.reason, "out_of_scope_request");
});

test("buildTurnExecutionPolicy does not swallow ordinary policy questions into out_of_scope", () => {
  const policy = buildPolicy("What policies should members follow?", "members");

  assert.equal(policy.profile, "live_lookup");
  assert.equal(policy.retrieval.mode, "allow");
  assert.equal(policy.retrieval.reason, "general_knowledge_query");
});

test("buildTurnExecutionPolicy keeps mixed structured-plus-context queries on retrieval path", () => {
  const policy = buildPolicy(
    "How many members do we have and summarize recent discussion context?",
    "general"
  );

  assert.equal(policy.profile, "live_lookup");
  assert.equal(policy.retrieval.mode, "allow");
  assert.equal(policy.retrieval.reason, "general_knowledge_query");
});

test("buildTurnExecutionPolicy skips retrieval for tool-only follow-up refinements", () => {
  const policy = buildPolicy("and alumni?", "members", "thread-1");

  assert.equal(policy.profile, "follow_up");
  assert.equal(policy.retrieval.mode, "skip");
  assert.equal(policy.retrieval.reason, "tool_only_structured_query");
});

test("buildTurnExecutionPolicy keeps context-dependent follow-ups on retrieval path", () => {
  const policy = buildPolicy("summarize that policy discussion", "general", "thread-1");

  assert.equal(policy.profile, "follow_up");
  assert.equal(policy.retrieval.mode, "allow");
  assert.equal(policy.retrieval.reason, "follow_up_requires_context");
});

test("buildTurnExecutionPolicy allows retrieval for ambiguous queries", () => {
  const policy = buildPolicy("Compare members and events", "general");

  assert.equal(policy.profile, "live_lookup");
  assert.equal(policy.retrieval.mode, "allow");
  assert.equal(policy.retrieval.reason, "ambiguous_query");
});
