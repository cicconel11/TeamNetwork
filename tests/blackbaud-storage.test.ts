import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("chunkArray", () => {
  it("splits into correct chunks", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    const items = [1, 2, 3, 4, 5];
    const chunks = chunkArray(items, 2);
    assert.deepEqual(chunks, [[1, 2], [3, 4], [5]]);
  });

  it("handles empty array", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([], 10), []);
  });

  it("handles chunk size larger than array", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([1, 2], 10), [[1, 2]]);
  });

  it("handles chunk size of 1", async () => {
    const { chunkArray } = await import("../src/lib/blackbaud/storage");
    assert.deepEqual(chunkArray([1, 2, 3], 1), [[1], [2], [3]]);
  });
});
