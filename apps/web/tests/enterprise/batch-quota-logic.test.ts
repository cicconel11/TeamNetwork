import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSubOrgCapacity,
  batchQuotaCheck,
} from "../../src/lib/enterprise/quota-logic";

describe("evaluateSubOrgCapacity", () => {
  it("returns unlimited when subOrgQuantity is null (legacy)", () => {
    const result = evaluateSubOrgCapacity(5, null);
    assert.equal(result.currentCount, 5);
    assert.equal(result.maxAllowed, null);
  });

  it("returns hard cap when subOrgQuantity is set", () => {
    const result = evaluateSubOrgCapacity(3, 6);
    assert.equal(result.currentCount, 3);
    assert.equal(result.maxAllowed, 6);
  });

  it("defaults to null when subOrgQuantity omitted", () => {
    const result = evaluateSubOrgCapacity(2);
    assert.equal(result.maxAllowed, null);
  });
});

describe("batchQuotaCheck", () => {
  it("allows batch when within limit", () => {
    const result = batchQuotaCheck(3, 6, 2);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3);
    assert.equal(result.wouldExceedBy, 0);
  });

  it("allows batch at exact limit", () => {
    const result = batchQuotaCheck(3, 6, 3);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3);
    assert.equal(result.wouldExceedBy, 0);
  });

  it("rejects batch that exceeds limit", () => {
    const result = batchQuotaCheck(3, 6, 4);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 3);
    assert.equal(result.wouldExceedBy, 1);
  });

  it("rejects batch when already at limit", () => {
    const result = batchQuotaCheck(6, 6, 1);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.equal(result.wouldExceedBy, 1);
  });

  it("allows any batch when subOrgQuantity is null (legacy unlimited)", () => {
    const result = batchQuotaCheck(100, null, 50);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, null);
    assert.equal(result.wouldExceedBy, 0);
  });

  it("handles zero current count", () => {
    const result = batchQuotaCheck(0, 3, 3);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3);
  });

  it("handles large batch exceeding by many", () => {
    const result = batchQuotaCheck(5, 6, 20);
    assert.equal(result.allowed, false);
    assert.equal(result.wouldExceedBy, 19);
    assert.equal(result.remaining, 1);
  });
});
