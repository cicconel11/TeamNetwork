import test, { describe } from "node:test";
import assert from "node:assert";
import { createPostSchema, createCommentSchema } from "../src/lib/schemas/feed.ts";

// ============================================================================
// Tests: createPostSchema
// ============================================================================

describe("createPostSchema", () => {
  test("accepts valid post body", () => {
    const result = createPostSchema.safeParse({ body: "Hello world" });
    assert.strictEqual(result.success, true);
  });

  test("accepts post body with exactly 1 character", () => {
    const result = createPostSchema.safeParse({ body: "A" });
    assert.strictEqual(result.success, true);
  });

  test("accepts post body with exactly 5000 characters", () => {
    const result = createPostSchema.safeParse({ body: "A".repeat(5000) });
    assert.strictEqual(result.success, true);
  });

  test("rejects empty post body", () => {
    const result = createPostSchema.safeParse({ body: "" });
    assert.strictEqual(result.success, false);
  });

  test("rejects post body over 5000 characters", () => {
    const result = createPostSchema.safeParse({ body: "A".repeat(5001) });
    assert.strictEqual(result.success, false);
  });

  test("rejects missing body field", () => {
    const result = createPostSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });

  test("rejects non-string body", () => {
    const result = createPostSchema.safeParse({ body: 123 });
    assert.strictEqual(result.success, false);
  });

  test("rejects whitespace-only body", () => {
    const result = createPostSchema.safeParse({ body: "   " });
    // safeString trims, so whitespace-only becomes empty
    assert.strictEqual(result.success, false);
  });
});

// ============================================================================
// Tests: createCommentSchema
// ============================================================================

describe("createCommentSchema", () => {
  test("accepts valid comment body", () => {
    const result = createCommentSchema.safeParse({ body: "Nice post!" });
    assert.strictEqual(result.success, true);
  });

  test("accepts comment body with exactly 1 character", () => {
    const result = createCommentSchema.safeParse({ body: "A" });
    assert.strictEqual(result.success, true);
  });

  test("accepts comment body with exactly 2000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "A".repeat(2000) });
    assert.strictEqual(result.success, true);
  });

  test("rejects empty comment body", () => {
    const result = createCommentSchema.safeParse({ body: "" });
    assert.strictEqual(result.success, false);
  });

  test("rejects comment body over 2000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "A".repeat(2001) });
    assert.strictEqual(result.success, false);
  });

  test("rejects missing body field", () => {
    const result = createCommentSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });

  test("rejects non-string body", () => {
    const result = createCommentSchema.safeParse({ body: 42 });
    assert.strictEqual(result.success, false);
  });

  test("rejects whitespace-only body", () => {
    const result = createCommentSchema.safeParse({ body: "   " });
    assert.strictEqual(result.success, false);
  });
});
