import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set env vars before importing the module so env helpers resolve correctly
process.env.BLACKBAUD_CLIENT_ID = process.env.BLACKBAUD_CLIENT_ID || "test-client-id";
process.env.NEXT_PUBLIC_SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.myteamnetwork.com";

const { isTokenExpired, getAuthorizationUrl, makeSyncError } = await import(
  "@/lib/blackbaud/oauth"
);

describe("Blackbaud OAuth", () => {
  it("isTokenExpired returns true for expired tokens", () => {
    const pastDate = new Date(Date.now() - 60_000);
    assert.equal(isTokenExpired(pastDate), true);
  });

  it("isTokenExpired returns false for fresh tokens", () => {
    const futureDate = new Date(Date.now() + 600_000);
    assert.equal(isTokenExpired(futureDate), false);
  });

  it("isTokenExpired returns true within buffer window", () => {
    // Token expires in 2 minutes, but buffer is 5 minutes
    const nearFuture = new Date(Date.now() + 120_000);
    assert.equal(isTokenExpired(nearFuture, 300), true);
  });

  it("getAuthorizationUrl returns a valid URL", () => {
    const url = getAuthorizationUrl("test-state-uuid");
    const parsed = new URL(url);

    assert.equal(parsed.hostname, "app.blackbaud.com");
    assert.equal(parsed.pathname, "/oauth/authorize");
    assert.equal(parsed.searchParams.get("client_id"), "test-client-id");
    assert.equal(parsed.searchParams.get("state"), "test-state-uuid");
    assert.ok(parsed.searchParams.get("redirect_uri")?.includes("/api/blackbaud/callback"));
  });

  it("makeSyncError creates structured error", () => {
    const error = makeSyncError("api_fetch", "RATE_LIMITED", "Too many requests");

    assert.equal(error.phase, "api_fetch");
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.message, "Too many requests");
    assert.ok(error.at); // ISO timestamp
  });
});
