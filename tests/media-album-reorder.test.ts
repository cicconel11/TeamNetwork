import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reorderAlbumsSchema } from "@/lib/schemas/media";

describe("reorderAlbumsSchema", () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "20000000-0000-4000-8000-000000000002";
  const c = "30000000-0000-4000-8000-000000000003";

  it("accepts empty albumIds (no-op reorder on empty org)", () => {
    const r = reorderAlbumsSchema.safeParse({ orgId, albumIds: [] });
    assert.equal(r.success, true);
    if (r.success) assert.deepEqual(r.data.albumIds, []);
  });

  it("accepts a valid permutation", () => {
    const r = reorderAlbumsSchema.safeParse({ orgId, albumIds: [a, b, c] });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.albumIds.length, 3);
  });

  it("rejects invalid uuid in albumIds", () => {
    const r = reorderAlbumsSchema.safeParse({ orgId, albumIds: [a, "not-a-uuid"] });
    assert.equal(r.success, false);
  });

  it("rejects invalid orgId", () => {
    const r = reorderAlbumsSchema.safeParse({ orgId: "bad", albumIds: [a] });
    assert.equal(r.success, false);
  });
});
