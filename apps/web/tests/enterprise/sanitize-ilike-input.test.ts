import test from "node:test";
import assert from "node:assert";
import { sanitizeIlikeInput } from "../../src/lib/security/validation.ts";

test("sanitizeIlikeInput: normal email passes through unchanged", () => {
  assert.strictEqual(sanitizeIlikeInput("alice@example.com"), "alice@example.com");
});

test("sanitizeIlikeInput: escapes % wildcard", () => {
  assert.strictEqual(sanitizeIlikeInput("%admin%"), "\\%admin\\%");
});

test("sanitizeIlikeInput: escapes _ wildcard", () => {
  assert.strictEqual(sanitizeIlikeInput("test_user@example.com"), "test\\_user@example.com");
});

test("sanitizeIlikeInput: escapes backslash", () => {
  assert.strictEqual(sanitizeIlikeInput("test\\@example.com"), "test\\\\@example.com");
});

test("sanitizeIlikeInput: escapes all three special chars in one string", () => {
  assert.strictEqual(sanitizeIlikeInput("%_\\"), "\\%\\_\\\\");
});

test("sanitizeIlikeInput: empty string returns empty string", () => {
  assert.strictEqual(sanitizeIlikeInput(""), "");
});

test("sanitizeIlikeInput: string with no special chars passes through unchanged", () => {
  assert.strictEqual(sanitizeIlikeInput("hello world"), "hello world");
});

test("sanitizeIlikeInput: real-world attack pattern %@evil.com", () => {
  assert.strictEqual(sanitizeIlikeInput("%@evil.com"), "\\%@evil.com");
});

test("sanitizeIlikeInput: multiple consecutive % wildcards", () => {
  assert.strictEqual(sanitizeIlikeInput("%%"), "\\%\\%");
});
