import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests that the schedules→calendar redirect pattern
 * correctly excludes API routes.
 *
 * The redirect source pattern is: /:orgSlug((?!api$)[^/]+)/schedules/:path*
 * This should match org page URLs but NOT /api/schedules/* API routes.
 */
describe("schedules→calendar redirect pattern", () => {
  // Simulates Next.js path-to-regexp matching for /:orgSlug((?!api$)[^/]+)/schedules/:path*
  const orgSlugPattern = /^(?!api$)[^/]+$/;

  function matchesRedirect(url: string): boolean {
    // Extract the first path segment (would be :orgSlug)
    const segments = url.split("/").filter(Boolean);
    if (segments.length < 2) return false;
    const orgSlug = segments[0];
    const secondSegment = segments[1];
    return orgSlugPattern.test(orgSlug) && secondSegment === "schedules";
  }

  it("matches org page URLs like /my-org/schedules", () => {
    assert.ok(matchesRedirect("/my-org/schedules"));
    assert.ok(matchesRedirect("/tk-richmond/schedules"));
    assert.ok(matchesRedirect("/beta-theta-pi/schedules/new"));
  });

  it("does NOT match API routes like /api/schedules/sources", () => {
    assert.ok(!matchesRedirect("/api/schedules/sources"));
    assert.ok(!matchesRedirect("/api/schedules/sources/some-id"));
    assert.ok(!matchesRedirect("/api/schedules/google/connect"));
  });

  it("matches org slugs that contain 'api' but aren't exactly 'api'", () => {
    assert.ok(matchesRedirect("/api-team/schedules"));
    assert.ok(matchesRedirect("/my-api/schedules"));
  });
});
