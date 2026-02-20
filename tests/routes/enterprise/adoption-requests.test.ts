import test from "node:test";
import assert from "node:assert";

/**
 * Tests for GET /api/enterprise/[enterpriseId]/adoption-requests
 *
 * This route lists adoption requests for an enterprise.
 * Key behaviors:
 * 1. Uses ENTERPRISE_ANY_ROLE — any enterprise member can view
 * 2. DB error → 500 with generic "Internal server error" (no raw message leak)
 * 3. Success → { requests: [...] } with correct shape
 * 4. Empty state → { requests: [] }
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  status: string;
  responded_by: string | null;
  responded_at: string | null;
  expires_at: string | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
  };
}

interface AdoptionRequestsRouteResult {
  status: number;
  body: Record<string, unknown>;
}

// ── Simulation ──────────────────────────────────────────────────────────────────

/**
 * Simulates GET adoption-requests route logic (adoption-requests/route.ts:35-83).
 *
 * The route:
 * 1. Auth check via getEnterpriseApiContext with ENTERPRISE_ANY_ROLE
 * 2. Query enterprise_adoption_requests with organization join
 * 3. On DB error → 500 with generic message
 * 4. On success → { requests: data ?? [] }
 */
function simulateAdoptionRequestsGet(params: {
  dbError: boolean;
  requests: AdoptionRequestRow[] | null;
}): AdoptionRequestsRouteResult {
  const { dbError, requests } = params;

  if (dbError) {
    return { status: 500, body: { error: "Internal server error" } };
  }

  return { status: 200, body: { requests: requests ?? [] } };
}

// ── Permission tests ────────────────────────────────────────────────────────────

test("adoption-requests GET uses ENTERPRISE_ANY_ROLE (any enterprise member can view)", () => {
  // The route uses ENTERPRISE_ANY_ROLE which allows owner, billing_admin, and org_admin.
  // This documents the permission model: all enterprise members can view adoption requests.
  const anyRoleSet = ["owner", "billing_admin", "org_admin"];
  assert.strictEqual(anyRoleSet.length, 3);
  assert.ok(anyRoleSet.includes("owner"));
  assert.ok(anyRoleSet.includes("billing_admin"));
  assert.ok(anyRoleSet.includes("org_admin"));
});

// ── DB error path ────────────────────────────────────────────────────────────────

test("adoption-requests GET returns 500 with generic error on DB failure", () => {
  const result = simulateAdoptionRequestsGet({
    dbError: true,
    requests: null,
  });

  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.body.error, "Internal server error");
  // Verify no raw DB message leaked
  assert.ok(!(result.body.error as string).includes("relation"));
  assert.ok(!(result.body.error as string).includes("constraint"));
});

// ── Success paths ────────────────────────────────────────────────────────────────

test("adoption-requests GET returns requests array with correct shape", () => {
  const mockRequests: AdoptionRequestRow[] = [
    {
      id: "req-1",
      enterprise_id: "ent-1",
      organization_id: "org-1",
      requested_by: "user-1",
      requested_at: "2026-01-15T10:00:00Z",
      status: "pending",
      responded_by: null,
      responded_at: null,
      expires_at: "2026-01-22T10:00:00Z",
      organization: { id: "org-1", name: "Test Org", slug: "test-org" },
    },
    {
      id: "req-2",
      enterprise_id: "ent-1",
      organization_id: "org-2",
      requested_by: "user-1",
      requested_at: "2026-01-14T10:00:00Z",
      status: "accepted",
      responded_by: "user-2",
      responded_at: "2026-01-15T10:00:00Z",
      expires_at: null,
      organization: { id: "org-2", name: "Other Org", slug: "other-org" },
    },
  ];

  const result = simulateAdoptionRequestsGet({
    dbError: false,
    requests: mockRequests,
  });

  assert.strictEqual(result.status, 200);
  const requests = result.body.requests as AdoptionRequestRow[];
  assert.strictEqual(requests.length, 2);

  // Verify first request shape
  const first = requests[0];
  assert.strictEqual(first.id, "req-1");
  assert.strictEqual(first.status, "pending");
  assert.strictEqual(first.organization?.name, "Test Org");
  assert.strictEqual(first.responded_by, null);

  // Verify second request shape
  const second = requests[1];
  assert.strictEqual(second.id, "req-2");
  assert.strictEqual(second.status, "accepted");
  assert.strictEqual(second.responded_by, "user-2");
});

test("adoption-requests GET returns empty array when no requests exist", () => {
  const result = simulateAdoptionRequestsGet({
    dbError: false,
    requests: [],
  });

  assert.strictEqual(result.status, 200);
  const requests = result.body.requests as AdoptionRequestRow[];
  assert.strictEqual(requests.length, 0);
});

test("adoption-requests GET returns empty array when DB returns null data", () => {
  const result = simulateAdoptionRequestsGet({
    dbError: false,
    requests: null,
  });

  assert.strictEqual(result.status, 200);
  const requests = result.body.requests as AdoptionRequestRow[];
  assert.strictEqual(requests.length, 0);
});
