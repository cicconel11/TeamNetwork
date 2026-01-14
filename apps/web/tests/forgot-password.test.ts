import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRedirectPath, buildRecoveryRedirectTo } from "../src/lib/auth/redirect";
import { validateNewPassword } from "../src/lib/auth/password";

describe("sanitizeRedirectPath", () => {
  it("returns /app for null input", () => {
    assert.equal(sanitizeRedirectPath(null), "/app");
  });

  it("returns /app for empty string", () => {
    assert.equal(sanitizeRedirectPath(""), "/app");
  });

  it("returns /app for whitespace-only string", () => {
    assert.equal(sanitizeRedirectPath("  "), "/app");
  });

  it("preserves a valid internal path", () => {
    assert.equal(sanitizeRedirectPath("/some/path"), "/some/path");
  });

  it("blocks protocol-relative URLs (//evil.com)", () => {
    assert.equal(sanitizeRedirectPath("//evil.com"), "/app");
  });

  it("blocks absolute URLs with scheme (https://evil.com)", () => {
    assert.equal(sanitizeRedirectPath("https://evil.com"), "/app");
  });

  it("blocks backslash-based redirect (/\\evil.com)", () => {
    assert.equal(sanitizeRedirectPath("/\\evil.com"), "/app");
  });

  it("blocks URL-encoded backslash (/%5Cevil.com decoded)", () => {
    const decoded = decodeURIComponent("/%5Cevil.com");
    assert.equal(sanitizeRedirectPath(decoded), "/app");
  });

  it("returns /app for paths without leading slash", () => {
    assert.equal(sanitizeRedirectPath("no-leading-slash"), "/app");
  });

  it("preserves path with query params", () => {
    assert.equal(
      sanitizeRedirectPath("/auth/reset-password?redirect=%2Fapp"),
      "/auth/reset-password?redirect=%2Fapp"
    );
  });

  it("trims whitespace from valid paths", () => {
    assert.equal(sanitizeRedirectPath("  /dashboard  "), "/dashboard");
  });

  it("blocks http:// scheme", () => {
    assert.equal(sanitizeRedirectPath("http://evil.com/path"), "/app");
  });

  it("blocks javascript: scheme embedded in path", () => {
    assert.equal(sanitizeRedirectPath("javascript://alert(1)"), "/app");
  });

  it("blocks null byte injection", () => {
    assert.equal(sanitizeRedirectPath("/app\x00//evil.com"), "/app");
  });

  it("blocks tab-based bypass", () => {
    assert.equal(sanitizeRedirectPath("/\tevil.com"), "/app");
  });
});

describe("buildRecoveryRedirectTo", () => {
  it("produces correct absolute URL with double-encoded inner redirect", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com", "/dashboard");
    const url = new URL(result);

    assert.equal(url.origin, "https://www.example.com");
    assert.equal(url.pathname, "/auth/callback");

    const redirectParam = url.searchParams.get("redirect");
    assert.ok(redirectParam);
    assert.ok(redirectParam.startsWith("/auth/reset-password?redirect="));

    const innerUrl = new URLSearchParams(redirectParam.split("?")[1]);
    assert.equal(innerUrl.get("redirect"), "/dashboard");
  });

  it("strips trailing slash from siteUrl", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com/", "/app");
    assert.ok(result.startsWith("https://www.example.com/auth/callback"));
    assert.ok(!result.includes("//auth/callback"));
  });

  it("sanitizes the inner redirect path", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com", "//evil.com");
    const url = new URL(result);
    const redirectParam = url.searchParams.get("redirect");
    assert.ok(redirectParam);
    const innerUrl = new URLSearchParams(redirectParam.split("?")[1]);
    assert.equal(innerUrl.get("redirect"), "/app");
  });
});

describe("validateNewPassword", () => {
  it("returns error for short password", () => {
    assert.equal(
      validateNewPassword("abc", "abc"),
      "Password must be at least 12 characters"
    );
  });

  it("returns error for mismatched passwords", () => {
    assert.equal(
      validateNewPassword("ValidPass123!", "ValidPass456!"),
      "Passwords do not match"
    );
  });

  it("returns null for valid matching passwords", () => {
    assert.equal(validateNewPassword("ValidPass123!", "ValidPass123!"), null);
  });

  it("returns null for exactly 12 character password", () => {
    assert.equal(validateNewPassword("ValidPass1!A", "ValidPass1!A"), null);
  });

  it("checks length before match", () => {
    assert.equal(
      validateNewPassword("ab", "cd"),
      "Password must be at least 12 characters"
    );
  });
});
