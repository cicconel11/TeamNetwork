import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInitialAIPanelOpen } from "../src/components/ai-assistant/panel-preferences.ts";

describe("resolveInitialAIPanelOpen", () => {
  it("auto-opens for first-visit desktop admins", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: true,
        isDesktop: true,
      }),
      true
    );
  });

  it("stays closed for first-visit mobile admins", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: true,
        isDesktop: false,
      }),
      false
    );
  });

  it("stays closed for non-admin desktop users", () => {
    assert.equal(
      resolveInitialAIPanelOpen({
        isAdmin: false,
        isDesktop: true,
      }),
      false
    );
  });
});
