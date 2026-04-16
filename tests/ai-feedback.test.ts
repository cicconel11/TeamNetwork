import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aiFeedbackSchema, aiFeedbackRatingSchema } from "@/lib/schemas/ai-feedback";

describe("aiFeedbackRatingSchema", () => {
  it("accepts positive rating", () => {
    const result = aiFeedbackRatingSchema.safeParse("positive");
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data, "positive");
    }
  });

  it("accepts negative rating", () => {
    const result = aiFeedbackRatingSchema.safeParse("negative");
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data, "negative");
    }
  });

  it("rejects invalid rating", () => {
    const result = aiFeedbackRatingSchema.safeParse("neutral");
    assert.equal(result.success, false);
  });
});

describe("aiFeedbackSchema", () => {
  it("validates complete feedback", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      rating: "positive",
      comment: "This was helpful!",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.messageId, "550e8400-e29b-41d4-a716-446655440000");
      assert.equal(result.data.rating, "positive");
      assert.equal(result.data.comment, "This was helpful!");
    }
  });

  it("validates feedback without comment", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      rating: "negative",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.comment, undefined);
    }
  });

  it("rejects invalid messageId", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "not-a-uuid",
      rating: "positive",
    });
    assert.equal(result.success, false);
  });

  it("rejects missing messageId", () => {
    const result = aiFeedbackSchema.safeParse({
      rating: "positive",
    });
    assert.equal(result.success, false);
  });

  it("rejects missing rating", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
    });
    assert.equal(result.success, false);
  });

  it("rejects comment over 1000 chars", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      rating: "negative",
      comment: "x".repeat(1001),
    });
    assert.equal(result.success, false);
  });

  it("accepts comment exactly 1000 chars", () => {
    const result = aiFeedbackSchema.safeParse({
      messageId: "550e8400-e29b-41d4-a716-446655440000",
      rating: "positive",
      comment: "x".repeat(1000),
    });
    assert.equal(result.success, true);
  });
});
