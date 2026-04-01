import test from "node:test";
import assert from "node:assert/strict";
import { checkBatchLimit } from "@/lib/media/gallery-validation";

test("folder upload batch limit allows up to one hundred files", () => {
  assert.equal(checkBatchLimit(100).valid, true);
});

test("folder upload batch limit rejects more than one hundred files", () => {
  const result = checkBatchLimit(101);
  assert.equal(result.valid, false);
  assert.equal(result.error, "Maximum 100 files per batch.");
});
