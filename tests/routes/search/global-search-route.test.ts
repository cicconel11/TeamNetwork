import test from "node:test";
import assert from "node:assert/strict";
import { globalSearchApiParamsSchema } from "@/lib/schemas";

test("globalSearchApiParamsSchema rejects empty q", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "   ", mode: "fast" });
  assert.equal(r.success, false);
});

test("globalSearchApiParamsSchema accepts valid q and mode", () => {
  const r = globalSearchApiParamsSchema.safeParse({ q: "hello", mode: "ai", limit: "10" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.mode, "ai");
    assert.equal(r.data.limit, 10);
    assert.ok(r.data.q.length > 0);
  }
});
