import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveSurfaceRouting } from "../src/lib/ai/intent-router";

describe("resolveSurfaceRouting — surface axis", () => {
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

  it("reroutes members questions from general surface", () => {
    const result = resolveSurfaceRouting("Tell me about members", "general");

    assert.equal(result.intent, "members_query");
    assert.equal(result.effectiveSurface, "members");
    assert.equal(result.rerouted, true);
    assert.equal(result.confidence, "high");
  });

  it("reroutes connection questions from general surface to members", () => {
    const result = resolveSurfaceRouting("Give me connection for Louis Ciccone", "general");

    assert.equal(result.intent, "members_query");
    assert.equal(result.effectiveSurface, "members");
    assert.equal(result.rerouted, true);
    assert.equal(result.confidence, "high");
  });

  it("returns ambiguous_query when multiple surfaces tie", () => {
    const result = resolveSurfaceRouting("Compare members and events", "general");

    assert.equal(result.intent, "ambiguous_query");
    assert.equal(result.effectiveSurface, "general");
    assert.equal(result.confidence, "low");
  });
});

describe("resolveSurfaceRouting — intent type axis", () => {
  it("classifies a pure greeting as casual", () => {
    const result = resolveSurfaceRouting("hello", "general");

    assert.equal(result.intentType, "casual");
    assert.equal(result.skipRetrieval, true);
  });

  it("classifies a farewell as casual", () => {
    const result = resolveSurfaceRouting("goodbye", "general");

    assert.equal(result.intentType, "casual");
  });

  it("classifies thanks as casual", () => {
    const result = resolveSurfaceRouting("thank you so much", "general");

    assert.equal(result.intentType, "casual");
  });

  it("classifies an acknowledgement as casual", () => {
    const result = resolveSurfaceRouting("ok", "general");

    assert.equal(result.intentType, "casual");
  });

  it("classifies a knowledge question as knowledge_query", () => {
    const result = resolveSurfaceRouting("What policies should members follow?", "members");

    assert.equal(result.intentType, "knowledge_query");
    assert.equal(result.intent, "members_query");
  });

  it("classifies a who/what/how question as knowledge_query", () => {
    const result = resolveSurfaceRouting("How many events happened last month?", "events");

    assert.equal(result.intentType, "knowledge_query");
    assert.equal(result.intent, "events_query");
  });

  it("classifies a create request as action_request", () => {
    const result = resolveSurfaceRouting("Create a new event for Friday", "events");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "events_query");
  });

  it("classifies an add request as action_request", () => {
    const result = resolveSurfaceRouting("Add John to the roster", "members");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "members_query");
  });

  it("classifies a delete request as action_request", () => {
    const result = resolveSurfaceRouting("Delete the cancelled meeting", "events");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "events_query");
  });

  it("classifies an invite request as action_request", () => {
    const result = resolveSurfaceRouting("Invite all alumni to the reunion", "members");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "members_query");
  });

  it("classifies a schedule request as action_request", () => {
    const result = resolveSurfaceRouting("Schedule a team meeting for next week", "general");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "events_query");
  });

  it("classifies a send request as action_request", () => {
    const result = resolveSurfaceRouting("Send a reminder to all members", "members");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "members_query");
  });

  it("classifies a cancel request as action_request", () => {
    const result = resolveSurfaceRouting("Cancel tomorrow's event", "events");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "events_query");
  });

  it("classifies 'go to' as navigation", () => {
    const result = resolveSurfaceRouting("Go to the members page", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "members_query");
  });

  it("classifies 'show me' as navigation", () => {
    const result = resolveSurfaceRouting("Show me the calendar", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "events_query");
  });

  it("classifies 'take me to' as navigation", () => {
    const result = resolveSurfaceRouting("Take me to the analytics dashboard", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "analytics_query");
  });

  it("classifies 'where is' as navigation", () => {
    const result = resolveSurfaceRouting("Where is the donations page?", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "analytics_query");
  });

  it("classifies 'open' as navigation", () => {
    const result = resolveSurfaceRouting("Open the events list", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "events_query");
  });

  it("classifies 'where can I find' as navigation", () => {
    const result = resolveSurfaceRouting("Where can I find the roster?", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "members_query");
  });

  it("defaults to knowledge_query for unmatched messages", () => {
    const result = resolveSurfaceRouting("What's the meaning of life?", "general");

    assert.equal(result.intentType, "knowledge_query");
    assert.equal(result.intent, "general_query");
  });
});

describe("resolveSurfaceRouting — intent type priority", () => {
  it("casual takes priority over action keywords in a full greeting", () => {
    // "ok" is both a casual message and could be confused, but as a standalone
    // message it should be casual
    const result = resolveSurfaceRouting("ok", "general");

    assert.equal(result.intentType, "casual");
  });

  it("action takes priority over navigation when both match", () => {
    // "open" is nav but "create" is action — action wins
    const result = resolveSurfaceRouting("Create and open a new event", "general");

    assert.equal(result.intentType, "action_request");
  });

  it("greeting + action question is classified as action_request, not casual", () => {
    // "hey, create an event" — not a pure greeting, has more content
    const result = resolveSurfaceRouting("hey, create an event for Friday", "general");

    assert.equal(result.intentType, "action_request");
    assert.equal(result.intent, "events_query");
    assert.equal(result.skipRetrieval, false);
  });

  it("greeting + navigation is classified as navigation, not casual", () => {
    const result = resolveSurfaceRouting("hi, show me the members page", "general");

    assert.equal(result.intentType, "navigation");
    assert.equal(result.intent, "members_query");
    assert.equal(result.skipRetrieval, false);
  });
});
