import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeToSurface } from "../src/components/ai-assistant/route-surface.ts";
import { getAssistantCapabilitySnapshot } from "../src/lib/ai/capabilities.ts";

describe("enterprise AI route surface", () => {
  it("maps enterprise alumni routes to the members surface", () => {
    assert.equal(routeToSurface("/enterprise/acme/alumni"), "members");
  });

  it("exposes enterprise tools on enterprise billing routes", () => {
    const snapshot = getAssistantCapabilitySnapshot("/enterprise/acme/billing", "analytics");
    const toolNames = snapshot.supported.map((entry) => entry.toolName).sort();

    assert.deepEqual(toolNames, [
      "get_enterprise_quota",
      "get_enterprise_stats",
      "list_managed_orgs",
    ]);
  });
});
