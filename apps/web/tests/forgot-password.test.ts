import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRedirectPath,
  buildRecoveryRedirectTo,
  sanitizeRecoveryNextParam,
} from "../src/lib/auth/redirect";
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
  it("produces /auth/confirm with encoded next pointing at reset-password + redirect", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com", "/dashboard");
    const url = new URL(result);

    assert.equal(url.origin, "https://www.example.com");
    assert.equal(url.pathname, "/auth/confirm");

    const nextParam = url.searchParams.get("next");
    assert.ok(nextParam);
    assert.ok(nextParam.includes("/auth/reset-password"));
    assert.ok(nextParam.includes("redirect"));

    const decoded = decodeURIComponent(nextParam);
    const inner = new URLSearchParams(decoded.split("?")[1] ?? "");
    assert.equal(inner.get("redirect"), "/dashboard");
  });

  it("strips trailing slash from siteUrl", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com/", "/app");
    assert.ok(result.startsWith("https://www.example.com/auth/confirm"));
    assert.ok(!result.includes("//auth/confirm"));
  });

  it("sanitizes the inner redirect path to /app and omits redundant redirect query", () => {
    const result = buildRecoveryRedirectTo("https://www.example.com", "//evil.com");
    const url = new URL(result);
    const nextParam = url.searchParams.get("next");
    assert.ok(nextParam);
    const decoded = decodeURIComponent(nextParam);
    assert.equal(decoded, "/auth/reset-password");
  });
});

describe("sanitizeRecoveryNextParam", () => {
  it("defaults to /auth/reset-password", () => {
    assert.equal(sanitizeRecoveryNextParam(null), "/auth/reset-password");
    assert.equal(sanitizeRecoveryNextParam(""), "/auth/reset-password");
  });

  it("accepts encoded reset-password path with redirect", () => {
    const raw = encodeURIComponent("/auth/reset-password?redirect=%2Ffoo");
    assert.equal(
      sanitizeRecoveryNextParam(raw),
      "/auth/reset-password?redirect=%2Ffoo"
    );
  });

  it("rejects non-reset-password paths", () => {
    assert.equal(sanitizeRecoveryNextParam("/auth/login"), "/auth/reset-password");
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
