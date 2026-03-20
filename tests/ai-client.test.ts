import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("createZaiClient", () => {
  it("throws when ZAI_API_KEY is not set", async () => {
    const saved = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;
    try {
      // Dynamic import to re-evaluate module
      const mod = await import("../src/lib/ai/client.ts");
      assert.throws(() => mod.createZaiClient(), /ZAI_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.ZAI_API_KEY = saved;
    }
  });

  it("creates OpenAI instance with z.ai base URL", async () => {
    process.env.ZAI_API_KEY = "test-key";
    const { createZaiClient } = await import("../src/lib/ai/client.ts");
    const client = createZaiClient();
    assert.ok(client);
    assert.equal((client as any).baseURL, "https://api.z.ai/api/paas/v4");
    delete process.env.ZAI_API_KEY;
  });

  it("uses ZAI_MODEL env var with fallback", async () => {
    process.env.ZAI_API_KEY = "test-key";
    const { getZaiModel } = await import("../src/lib/ai/client.ts");
    // Default
    delete process.env.ZAI_MODEL;
    assert.equal(getZaiModel(), "glm-5");
    // Override
    process.env.ZAI_MODEL = "glm-4.6v";
    assert.equal(getZaiModel(), "glm-4.6v");
    delete process.env.ZAI_MODEL;
    delete process.env.ZAI_API_KEY;
  });
});
