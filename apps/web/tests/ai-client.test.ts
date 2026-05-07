import test from "node:test";
import assert from "node:assert/strict";

test("getZaiModel defaults to glm-5.1", async () => {
  const previous = process.env.ZAI_MODEL;
  delete process.env.ZAI_MODEL;

  const { getZaiModel } = await import("../src/lib/ai/client.ts");

  assert.equal(getZaiModel(), "glm-5.1");

  if (previous === undefined) {
    delete process.env.ZAI_MODEL;
  } else {
    process.env.ZAI_MODEL = previous;
  }
});
