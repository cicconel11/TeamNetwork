import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRedirectPath } from "../src/lib/auth/redirect";

describe("invite redirect threading", () => {
  describe("sanitizeRedirectPath with invite tokens", () => {
    it("preserves /app/join with token query param", () => {
      assert.equal(
        sanitizeRedirectPath("/app/join?token=abc123"),
        "/app/join?token=abc123"
      );
    });

    it("preserves /app/join with encoded token", () => {
      assert.equal(
        sanitizeRedirectPath("/app/join%3Ftoken%3Dabc123"),
        "/app/join%3Ftoken%3Dabc123"
      );
    });

    it("preserves /app/join with multiple query params", () => {
      assert.equal(
        sanitizeRedirectPath("/app/join?token=abc123&type=org"),
        "/app/join?token=abc123&type=org"
      );
    });

    it("blocks invite-like paths with protocol injection", () => {
      assert.equal(
        sanitizeRedirectPath("//evil.com/app/join?token=abc"),
        "/app"
      );
    });

    it("blocks invite-like paths with backslash injection", () => {
      assert.equal(
        sanitizeRedirectPath("/\\evil.com/app/join?token=abc"),
        "/app"
      );
    });
  });

  describe("middleware redirect URL construction", () => {
    it("preserves full path with query string", () => {
      // Simulates what middleware does: pathname + search
      const pathname = "/app/join";
      const search = "?token=abc123";
      const fullPath = pathname + search;

      assert.equal(fullPath, "/app/join?token=abc123");

      // Verify sanitizeRedirectPath accepts the full path
      assert.equal(sanitizeRedirectPath(fullPath), "/app/join?token=abc123");
    });

    it("handles path with no query string", () => {
      const pathname = "/app/join";
      const search = "";
      const fullPath = pathname + search;

      assert.equal(fullPath, "/app/join");
      assert.equal(sanitizeRedirectPath(fullPath), "/app/join");
    });

    it("preserves parent invite path with query string", () => {
      const pathname = "/app/parents-join";
      const search = "?code=xyz789";
      const fullPath = pathname + search;

      assert.equal(
        sanitizeRedirectPath(fullPath),
        "/app/parents-join?code=xyz789"
      );
    });

    it("round-trips through encodeURIComponent and back", () => {
      const originalPath = "/app/join?token=abc123";
      const encoded = encodeURIComponent(originalPath);
      const decoded = decodeURIComponent(encoded);

      assert.equal(decoded, originalPath);
      assert.equal(sanitizeRedirectPath(decoded), originalPath);
    });
  });
});
