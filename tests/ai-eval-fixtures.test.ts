import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSurfaceRouting } from "../src/lib/ai/intent-router";
import { checkCacheEligibility, type CacheSurface } from "../src/lib/ai/semantic-cache-utils";
import { buildTurnExecutionPolicy } from "../src/lib/ai/turn-execution-policy";
import {
  getForcedPass1ToolChoice,
  getPass1Tools,
} from "../src/app/api/ai/[orgId]/chat/handler/pass1-tools";

interface AiEvalFixture {
  id: string;
  prompt: string;
  requestedSurface: CacheSurface;
  expected: {
    surface: CacheSurface;
    intentType: string;
    profile: string;
    toolCalls: string[];
    answerShape: "tool_response" | "pending_action" | "refusal";
  };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(
  readFileSync(resolve(root, "tests/fixtures/ai-evals/seed.json"), "utf8"),
) as AiEvalFixture[];

function runDeterministicEval(fixture: AiEvalFixture) {
  const routing = resolveSurfaceRouting(fixture.prompt, fixture.requestedSurface);
  const cacheEligibility = checkCacheEligibility({
    message: fixture.prompt,
    surface: routing.effectiveSurface,
  });
  const policy = buildTurnExecutionPolicy({
    message: fixture.prompt,
    requestedSurface: fixture.requestedSurface,
    routing,
    cacheEligibility,
  });
  const pass1Tools = getPass1Tools(
    fixture.prompt,
    policy.surface,
    policy.toolPolicy,
    policy.intentType,
  );
  const toolCalls = (pass1Tools ?? []).map((tool) => tool.function.name);
  const forcedToolChoice = getForcedPass1ToolChoice(pass1Tools);
  const forcedTool =
    forcedToolChoice && typeof forcedToolChoice === "object" && "function" in forcedToolChoice
      ? forcedToolChoice.function.name
      : null;

  const answerShape =
    policy.profile === "out_of_scope_unrelated" || policy.profile === "out_of_scope"
      ? "refusal"
      : toolCalls.some((name) => name.startsWith("prepare_"))
        ? "pending_action"
        : toolCalls.length > 0
          ? "tool_response"
          : "refusal";

  return {
    surface: policy.surface,
    intentType: policy.intentType,
    profile: policy.profile,
    toolCalls,
    forcedTool,
    answerShape,
  };
}

for (const fixture of fixtures) {
  test(`AI eval fixture: ${fixture.id}`, () => {
    const actual = runDeterministicEval(fixture);

    assert.equal(actual.surface, fixture.expected.surface);
    assert.equal(actual.intentType, fixture.expected.intentType);
    assert.equal(actual.profile, fixture.expected.profile);
    assert.deepEqual(actual.toolCalls, fixture.expected.toolCalls);
    assert.equal(actual.answerShape, fixture.expected.answerShape);
    if (fixture.expected.toolCalls.length === 1) {
      assert.equal(actual.forcedTool, fixture.expected.toolCalls[0]);
    }
  });
}
