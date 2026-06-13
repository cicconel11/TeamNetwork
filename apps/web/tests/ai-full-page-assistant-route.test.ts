import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isFullPageAssistantRoute } from "../src/components/ai-assistant/route-surface.ts";

describe("isFullPageAssistantRoute", () => {
  it("matches the org-scoped assistant page", () => {
    assert.equal(isFullPageAssistantRoute("/acme/assistant"), true);
  });

  it("matches assistant sub-paths", () => {
    assert.equal(isFullPageAssistantRoute("/acme/assistant/anything"), true);
  });

  it("ignores query strings and hashes", () => {
    assert.equal(isFullPageAssistantRoute("/acme/assistant?thread=t1"), true);
    assert.equal(isFullPageAssistantRoute("/acme/assistant#top"), true);
  });

  it("does not match other org routes", () => {
    assert.equal(isFullPageAssistantRoute("/acme"), false);
    assert.equal(isFullPageAssistantRoute("/acme/members"), false);
    assert.equal(isFullPageAssistantRoute("/acme/calendar"), false);
  });

  it("does not match routes that merely contain the word assistant", () => {
    assert.equal(isFullPageAssistantRoute("/acme/assistant-archive"), false);
    assert.equal(isFullPageAssistantRoute("/assistant"), false);
  });

  it("does not match enterprise routes", () => {
    assert.equal(isFullPageAssistantRoute("/enterprise/acme/assistant"), false);
    assert.equal(isFullPageAssistantRoute("/enterprise/assistant"), false);
  });
});
