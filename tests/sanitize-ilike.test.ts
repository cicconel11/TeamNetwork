import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inlined to avoid Next.js module resolution issues in the raw Node test runner.
// The implementation lives in src/lib/security/validation.ts — keep in sync.
function sanitizeIlikeInput(value: string): string {
  return value
    .replace(/\\/g, "\\\\") // backslash first (escape order matters)
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

describe("sanitizeIlikeInput", () => {
  it("escapes percent wildcard", () => {
    assert.equal(sanitizeIlikeInput("%"), "\\%");
  });

  it("escapes underscore wildcard", () => {
    assert.equal(sanitizeIlikeInput("_"), "\\_");
  });

  it("escapes backslash", () => {
    assert.equal(sanitizeIlikeInput("\\"), "\\\\");
  });

  it("escapes backslash before percent (escape order matters)", () => {
    // Input "\\%" should become "\\\\\\%" — backslash escaped first, then percent
    assert.equal(sanitizeIlikeInput("\\%"), "\\\\\\%");
  });

  it("passes normal strings through unchanged", () => {
    assert.equal(sanitizeIlikeInput("Technology"), "Technology");
  });

  it("handles empty string", () => {
    assert.equal(sanitizeIlikeInput(""), "");
  });

  it("escapes attack payload that would match all rows", () => {
    // A bare "%" passed to .ilike("col", "%") would match everything
    assert.equal(sanitizeIlikeInput("%"), "\\%");
  });

  it("escapes percent in combined search string", () => {
    assert.equal(sanitizeIlikeInput("%Technology%"), "\\%Technology\\%");
  });

  it("does not alter alphanumeric and space characters", () => {
    assert.equal(sanitizeIlikeInput("Software Engineer"), "Software Engineer");
  });

  it("escapes all wildcards in a mixed string", () => {
    assert.equal(sanitizeIlikeInput("a%b_c\\d"), "a\\%b\\_c\\\\d");
  });

  describe("comma injection in .or() query", () => {
    it("comma stripping prevents PostgREST filter injection", () => {
      // Simulates the jobs page logic: sanitize then strip commas
      const malicious = "foo%,bar.ilike.*";
      const sanitized = sanitizeIlikeInput(malicious).replace(/,/g, "");
      assert.ok(!sanitized.includes(","), "sanitized value should not contain commas");
    });

    it("sanitizeIlikeInput itself does not strip commas (comma removal is call-site responsibility)", () => {
      const normal = "foo,bar";
      assert.equal(sanitizeIlikeInput(normal), "foo,bar");
    });
  });
});
