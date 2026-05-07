import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reorderMediaGallerySchema } from "@/lib/schemas/media";

describe("reorderMediaGallerySchema", () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "20000000-0000-4000-8000-000000000002";

  it("accepts empty mediaIds when org is empty", () => {
    const r = reorderMediaGallerySchema.safeParse({ orgId, mediaIds: [] });
    assert.equal(r.success, true);
  });

  it("accepts a valid id list", () => {
    const r = reorderMediaGallerySchema.safeParse({ orgId, mediaIds: [a, b] });
    assert.equal(r.success, true);
  });

  it("rejects invalid uuid in mediaIds", () => {
    const r = reorderMediaGallerySchema.safeParse({ orgId, mediaIds: [a, "x"] });
    assert.equal(r.success, false);
  });
});
