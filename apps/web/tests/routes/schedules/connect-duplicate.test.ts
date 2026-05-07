import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";

/**
 * Tests for duplicate schedule source URL prevention.
 * Fix 1: Connecting the same URL twice for the same org should return 409.
 */

interface ConnectRequest {
  auth: AuthContext;
  orgId: string;
  url: string;
  title?: string;
}

interface ConnectResult {
  status: number;
  error?: string;
  message?: string;
  source?: { id: string };
}

interface ConnectContext {
  existingSources: Array<{ org_id: string; source_url: string }>;
}

function simulateConnect(
  request: ConnectRequest,
  ctx: ConnectContext
): ConnectResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to connect schedules." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can connect schedules." };
  }

  // Simulate unique constraint check (org_id, source_url)
  const duplicate = ctx.existingSources.some(
    (s) => s.org_id === request.orgId && s.source_url === request.url
  );

  if (duplicate) {
    return {
      status: 409,
      error: "Already connected",
      message: "This schedule URL is already connected.",
    };
  }

  return {
    status: 200,
    source: { id: "new-source-id" },
  };
}

test("connecting a new URL succeeds", () => {
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://example.com/schedule.ics" },
    { existingSources: [] }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source?.id);
});

test("connecting the same URL twice returns 409", () => {
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://example.com/schedule.ics" },
    { existingSources: [{ org_id: "org-1", source_url: "https://example.com/schedule.ics" }] }
  );
  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.error, "Already connected");
  assert.ok(result.message?.includes("already connected"));
});

test("same URL in different orgs is allowed", () => {
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-2"), orgId: "org-2", url: "https://example.com/schedule.ics" },
    { existingSources: [{ org_id: "org-1", source_url: "https://example.com/schedule.ics" }] }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source?.id);
});

test("different URL in same org is allowed", () => {
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://example.com/other.ics" },
    { existingSources: [{ org_id: "org-1", source_url: "https://example.com/schedule.ics" }] }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source?.id);
});

test("non-admin cannot connect schedules", () => {
  const result = simulateConnect(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://example.com/schedule.ics" },
    { existingSources: [] }
  );
  assert.strictEqual(result.status, 403);
});

test("unauthenticated user cannot connect schedules", () => {
  const result = simulateConnect(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", url: "https://example.com/schedule.ics" },
    { existingSources: [] }
  );
  assert.strictEqual(result.status, 401);
});
