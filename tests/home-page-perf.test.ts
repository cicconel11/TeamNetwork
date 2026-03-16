import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("getCachedDonationStats column names", () => {
  it("selects total_amount_cents not total_amount in cached-queries.ts", () => {
    const src = readFileSync("src/lib/cached-queries.ts", "utf-8");
    assert.ok(src.includes("total_amount_cents"), "Should select total_amount_cents");
    assert.ok(!src.match(/select\([^)]*total_amount[^_]/), "Should not select bare total_amount");
  });

  it("selects total_amount_cents not total_amount in cache.ts", () => {
    const src = readFileSync("src/lib/cache.ts", "utf-8");
    assert.ok(src.includes("total_amount_cents"), "Should select total_amount_cents");
    assert.ok(!src.match(/select\([^)]*total_amount[^_]/), "Should not select bare total_amount");
  });
});
