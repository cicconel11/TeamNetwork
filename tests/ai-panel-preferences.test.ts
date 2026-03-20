import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInitialAIPanelOpen } from "../src/components/ai-assistant/panel-preferences.ts";

describe("resolveInitialAIPanelOpen", () => {
  it("auto-opens for first-visit desktop admins", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: true,
        isDesktop: true,
        persisted: null,
      }),
      true
    );
  });

  it("stays closed for first-visit mobile admins", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: true,
        isDesktop: false,
        persisted: null,
      }),
      false
    );
  });

  it("respects persisted closed state", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: true,
        isDesktop: true,
        persisted: "closed",
      }),
      false
    );
  });
});
