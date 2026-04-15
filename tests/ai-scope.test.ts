import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("AiScope helpers", () => {
  it("toAiScope wraps bare orgId string as org scope", async () => {
    const { toAiScope } = await import("../src/lib/ai/scope.ts");
    const s = toAiScope("org-1");
    assert.deepEqual(s, { scope: "org", orgId: "org-1" });
  });

  it("toAiScope passes through scope objects untouched", async () => {
    const { toAiScope } = await import("../src/lib/ai/scope.ts");
    const ent = { scope: "enterprise" as const, enterpriseId: "ent-1" };
    assert.equal(toAiScope(ent), ent);
  });

  it("scopeId returns orgId for org scope", async () => {
    const { scopeId } = await import("../src/lib/ai/scope.ts");
    assert.equal(scopeId({ scope: "org", orgId: "o-1" }), "o-1");
  });

  it("scopeId returns enterpriseId for enterprise scope", async () => {
    const { scopeId } = await import("../src/lib/ai/scope.ts");
    assert.equal(
      scopeId({ scope: "enterprise", enterpriseId: "e-1" }),
      "e-1"
    );
  });

  it("scopeLabel returns the discriminator", async () => {
    const { scopeLabel } = await import("../src/lib/ai/scope.ts");
    assert.equal(scopeLabel({ scope: "org", orgId: "o" }), "org");
    assert.equal(
      scopeLabel({ scope: "enterprise", enterpriseId: "e" }),
      "enterprise"
    );
  });

  it("assertOrgScope throws on enterprise scope", async () => {
    const { assertOrgScope } = await import("../src/lib/ai/scope.ts");
    assert.throws(() =>
      assertOrgScope({ scope: "enterprise", enterpriseId: "e" })
    );
  });

  it("assertEnterpriseScope throws on org scope", async () => {
    const { assertEnterpriseScope } = await import("../src/lib/ai/scope.ts");
    assert.throws(() => assertEnterpriseScope({ scope: "org", orgId: "o" }));
  });
});
