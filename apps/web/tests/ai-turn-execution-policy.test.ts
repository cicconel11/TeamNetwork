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
  assert.equal(policy.retrievalPolicy, "allow");
});

test("buildTurnExecutionPolicy marks casual turns as non-cacheable", () => {
  const policy = buildPolicy("Thanks!", "general");

  assert.equal(policy.profile, "casual");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "none");
  assert.equal(policy.retrievalPolicy, "skip");
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
  assert.equal(policy.retrievalPolicy, "allow");
});

test("buildTurnExecutionPolicy keeps governance-doc requests narrowly out_of_scope", () => {
  const policy = buildPolicy("Explain the organization bylaws", "general");

  assert.equal(policy.profile, "out_of_scope");
  assert.equal(policy.cachePolicy, "skip");
  assert.equal(policy.toolPolicy, "none");
  assert.equal(policy.retrievalPolicy, "skip");
});

test("buildTurnExecutionPolicy does not swallow ordinary policy questions into out_of_scope", () => {
  const policy = buildPolicy("What policies should members follow?", "members");

  assert.equal(policy.profile, "live_lookup");
});
