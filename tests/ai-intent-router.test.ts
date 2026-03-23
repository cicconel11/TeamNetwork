import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSurfaceRouting } from "../src/lib/ai/intent-router";

describe("resolveSurfaceRouting", () => {
  it("marks casual greetings to skip retrieval without rerouting the surface", () => {
    const result = resolveSurfaceRouting("hey there!", "members");

    assert.equal(result.intent, "general_query");
    assert.equal(result.effectiveSurface, "members");
    assert.equal(result.inferredSurface, null);
    assert.equal(result.rerouted, false);
    assert.equal(result.skipRetrieval, true);
  });

  it("marks gratitude messages to skip retrieval", () => {
    const result = resolveSurfaceRouting("Thanks!!", "general");

    assert.equal(result.skipRetrieval, true);
    assert.equal(result.effectiveSurface, "general");
  });

  it("does not skip retrieval when a greeting includes a knowledge request", () => {
    const result = resolveSurfaceRouting("hey, what events are coming up?", "general");

    assert.equal(result.skipRetrieval, false);
    assert.equal(result.intent, "events_query");
    assert.equal(result.effectiveSurface, "events");
    assert.equal(result.rerouted, true);
  });
});
