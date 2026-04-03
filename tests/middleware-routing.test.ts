import { describe, it } from "node:test";
import assert from "node:assert";
import {
  shouldBypassAuth,
  isPublicApiPattern,
  isPublicRoute,
  isAuthOnlyRoute,
  isOrgRoute,
  getRedirectForMembershipStatus,
  shouldRedirectToCanonicalHost,
} from "../src/lib/middleware/routing-decisions.ts";

describe("middleware routing decisions", () => {
  describe("shouldBypassAuth", () => {
    it("bypasses stripe webhook", () => assert.strictEqual(shouldBypassAuth("/api/stripe/webhook"), true));
    it("bypasses stripe webhook-connect", () => assert.strictEqual(shouldBypassAuth("/api/stripe/webhook-connect"), true));
    it("bypasses age validation", () => assert.strictEqual(shouldBypassAuth("/api/auth/validate-age"), true));
    it("bypasses telemetry error", () => assert.strictEqual(shouldBypassAuth("/api/telemetry/error"), true));
    it("bypasses feedback submit", () => assert.strictEqual(shouldBypassAuth("/api/feedback/submit"), true));
    it("bypasses feedback screenshot", () => assert.strictEqual(shouldBypassAuth("/api/feedback/screenshot"), true));
    it("does not bypass alumni route", () => assert.strictEqual(shouldBypassAuth("/api/organizations/123/alumni"), false));
    it("does not bypass blackbaud callback (handled after canonical-host redirect)", () => assert.strictEqual(shouldBypassAuth("/api/blackbaud/callback"), false));
  });

  describe("isPublicApiPattern", () => {
    it("matches parent invite accept", () => assert.strictEqual(isPublicApiPattern("/api/organizations/abc-123/parents/invite/accept"), true));
    it("does not match other org routes", () => assert.strictEqual(isPublicApiPattern("/api/organizations/abc-123/members"), false));
  });

  describe("isPublicRoute", () => {
    it("root is public", () => assert.strictEqual(isPublicRoute("/"), true));
    it("auth login is public", () => assert.strictEqual(isPublicRoute("/auth/login"), true));
    it("auth callback is public", () => assert.strictEqual(isPublicRoute("/auth/callback"), true));
    it("demos is public", () => assert.strictEqual(isPublicRoute("/demos"), true));
    it("terms is public", () => assert.strictEqual(isPublicRoute("/terms"), true));
    it("privacy is public", () => assert.strictEqual(isPublicRoute("/privacy"), true));
    it("parents-join is public", () => assert.strictEqual(isPublicRoute("/app/parents-join"), true));
    it("org route is not public", () => assert.strictEqual(isPublicRoute("/my-org/members"), false));
    it("app is not public", () => assert.strictEqual(isPublicRoute("/app"), false));
  });

  describe("isAuthOnlyRoute", () => {
    it("login is auth-only", () => assert.strictEqual(isAuthOnlyRoute("/auth/login"), true));
    it("signup is auth-only", () => assert.strictEqual(isAuthOnlyRoute("/auth/signup"), true));
    it("forgot-password is auth-only", () => assert.strictEqual(isAuthOnlyRoute("/auth/forgot-password"), true));
    it("callback is NOT auth-only", () => assert.strictEqual(isAuthOnlyRoute("/auth/callback"), false));
  });

  describe("isOrgRoute", () => {
    it("org member path is org-scoped", () => assert.strictEqual(isOrgRoute("/my-org/members"), true));
    it("root is not org-scoped", () => assert.strictEqual(isOrgRoute("/"), false));
    it("app is not org-scoped", () => assert.strictEqual(isOrgRoute("/app"), false));
    it("settings is not org-scoped", () => assert.strictEqual(isOrgRoute("/settings/language"), false));
    it("enterprise is not org-scoped", () => assert.strictEqual(isOrgRoute("/enterprise/acme"), false));
    it("public top-level pages are not org-scoped", () => {
      assert.strictEqual(isOrgRoute("/terms"), false);
      assert.strictEqual(isOrgRoute("/privacy"), false);
      assert.strictEqual(isOrgRoute("/demos"), false);
    });
  });

  describe("getRedirectForMembershipStatus", () => {
    it("revoked → /app?error=access_revoked", () => assert.strictEqual(getRedirectForMembershipStatus("revoked", "my-org"), "/app?error=access_revoked"));
    it("pending → /app?pending=slug", () => assert.strictEqual(getRedirectForMembershipStatus("pending", "my-org"), "/app?pending=my-org"));
    it("active → null", () => assert.strictEqual(getRedirectForMembershipStatus("active", "my-org"), null));
    it("null → null", () => assert.strictEqual(getRedirectForMembershipStatus(null, "my-org"), null));
    it("undefined → null", () => assert.strictEqual(getRedirectForMembershipStatus(undefined, "my-org"), null));
  });

  describe("shouldRedirectToCanonicalHost", () => {
    it("bare domain → true", () => assert.strictEqual(shouldRedirectToCanonicalHost("myteamnetwork.com"), true));
    it("www domain → false", () => assert.strictEqual(shouldRedirectToCanonicalHost("www.myteamnetwork.com"), false));
    it("localhost → false", () => assert.strictEqual(shouldRedirectToCanonicalHost("localhost:3000"), false));
    it("null → false", () => assert.strictEqual(shouldRedirectToCanonicalHost(null), false));
  });
});
