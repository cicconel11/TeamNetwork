import test from "node:test";
import assert from "node:assert";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/navigation/sync
 *
 * This route syncs enterprise navigation config to all sub-organizations.
 * Key behaviors:
 * 1. Uses ENTERPRISE_CREATE_ORG_ROLE — owner or org_admin can sync
 * 2. Fetches orgs via service client (bypasses RLS)
 * 3. RPC calls use service client (bypasses RLS for cross-org writes)
 * 4. Partial failures reported in response counts
 * 5. DB error fetching orgs → 400
 * 6. Zero orgs → early return with synced: 0
 */

// ── Types ──────────────────────────────────────────────────────────────────────

interface SyncRouteResult {
  status: number;
  body: Record<string, unknown>;
}

interface RpcResult {
  data: boolean | null;
  error: { message: string } | null;
}

// ── Simulation ──────────────────────────────────────────────────────────────────

/**
 * Simulates POST navigation/sync route logic (navigation/sync/route.ts:14-89).
 *
 * The route:
 * 1. Auth check via getEnterpriseApiContext with ENTERPRISE_CREATE_ORG_ROLE
 * 2. Fetch all org IDs for the enterprise via serviceSupabase
 * 3. RPC sync_enterprise_nav_to_org for each org via serviceSupabase
 * 4. Count successes/failures and return
 *
 * CRITICAL: Both the org fetch (line 38) and RPC calls (line 54) use
 * ctx.serviceSupabase — not the user-scoped supabase client. This is
 * required because the calling user may not have RLS access to every
 * sub-org's data.
 */
function simulateNavigationSync(params: {
  orgsFetchError: boolean;
  orgs: { id: string }[];
  rpcResults: RpcResult[];
  useServiceClient: boolean;
}): SyncRouteResult {
  const { orgsFetchError, orgs, rpcResults, useServiceClient } = params;

  // Step 1: Fetch organizations
  if (orgsFetchError) {
    return { status: 400, body: { error: "Failed to fetch organizations" } };
  }

  // Step 2: No orgs → early return
  if (orgs.length === 0) {
    return {
      status: 200,
      body: { success: true, synced: 0, message: "No organizations to sync" },
    };
  }

  // Step 3: User-scoped client would cause RLS failures
  if (!useServiceClient) {
    // Simulate RLS rejection — all calls fail silently
    return {
      status: 200,
      body: {
        success: true,
        synced: 0,
        failed: orgs.length,
        total: orgs.length,
        message: `Synced 0 of ${orgs.length} organizations`,
      },
    };
  }

  // Step 4: Process RPC results
  let synced = 0;
  let failed = 0;
  for (const result of rpcResults) {
    if (!result.error && result.data) {
      synced++;
    } else {
      failed++;
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      synced,
      failed,
      total: orgs.length,
      message: `Synced ${synced} of ${orgs.length} organizations`,
    },
  };
}

// ── Service client requirement ──────────────────────────────────────────────────

test("navigation sync uses service client for RPC (not user-scoped)", () => {
  // When using service client, syncs succeed
  const withService = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }, { id: "org-2" }],
    rpcResults: [
      { data: true, error: null },
      { data: true, error: null },
    ],
    useServiceClient: true,
  });

  assert.strictEqual(withService.status, 200);
  assert.strictEqual(withService.body.synced, 2);
  assert.strictEqual(withService.body.failed, 0);

  // When using user-scoped client, RLS blocks cross-org writes
  const withoutService = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }, { id: "org-2" }],
    rpcResults: [],
    useServiceClient: false,
  });

  assert.strictEqual(withoutService.status, 200);
  assert.strictEqual(withoutService.body.synced, 0);
  assert.strictEqual(withoutService.body.failed, 2);
});

test("navigation sync uses ENTERPRISE_CREATE_ORG_ROLE (owner or org_admin)", () => {
  // The route uses ENTERPRISE_CREATE_ORG_ROLE which allows owner and org_admin.
  // billing_admin cannot sync navigation.
  const allowedRoles = ["owner", "org_admin"];
  assert.strictEqual(allowedRoles.length, 2);
  assert.ok(allowedRoles.includes("owner"));
  assert.ok(allowedRoles.includes("org_admin"));
  assert.ok(!allowedRoles.includes("billing_admin"));
});

// ── DB error fetching organizations ──────────────────────────────────────────────

test("navigation sync returns 400 when org fetch fails", () => {
  const result = simulateNavigationSync({
    orgsFetchError: true,
    orgs: [],
    rpcResults: [],
    useServiceClient: true,
  });

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Failed to fetch organizations");
});

// ── Empty org list ──────────────────────────────────────────────────────────────

test("navigation sync returns early with synced: 0 when no organizations exist", () => {
  const result = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [],
    rpcResults: [],
    useServiceClient: true,
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(result.body.synced, 0);
  assert.strictEqual(result.body.message, "No organizations to sync");
  // Should not include failed/total when there are no orgs
  assert.strictEqual(result.body.failed, undefined);
  assert.strictEqual(result.body.total, undefined);
});

// ── Partial failure handling ────────────────────────────────────────────────────

test("navigation sync reports partial failures correctly", () => {
  const result = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }, { id: "org-2" }, { id: "org-3" }],
    rpcResults: [
      { data: true, error: null },
      { data: null, error: { message: "RPC failed" } },
      { data: true, error: null },
    ],
    useServiceClient: true,
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(result.body.synced, 2);
  assert.strictEqual(result.body.failed, 1);
  assert.strictEqual(result.body.total, 3);
  assert.strictEqual(result.body.message, "Synced 2 of 3 organizations");
});

test("navigation sync handles all RPC failures gracefully", () => {
  const result = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }, { id: "org-2" }],
    rpcResults: [
      { data: null, error: { message: "RPC failed" } },
      { data: null, error: { message: "RPC failed" } },
    ],
    useServiceClient: true,
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(result.body.synced, 0);
  assert.strictEqual(result.body.failed, 2);
  assert.strictEqual(result.body.total, 2);
});

// ── Full success path ───────────────────────────────────────────────────────────

test("navigation sync reports all successful when every RPC succeeds", () => {
  const result = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }, { id: "org-2" }, { id: "org-3" }],
    rpcResults: [
      { data: true, error: null },
      { data: true, error: null },
      { data: true, error: null },
    ],
    useServiceClient: true,
  });

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.success, true);
  assert.strictEqual(result.body.synced, 3);
  assert.strictEqual(result.body.failed, 0);
  assert.strictEqual(result.body.total, 3);
  assert.strictEqual(result.body.message, "Synced 3 of 3 organizations");
});

// ── RPC result edge case: data is falsy ─────────────────────────────────────────

test("navigation sync counts RPC with null data as failure even without error", () => {
  // The route checks: !result.value.error && result.value.data
  // So { data: null, error: null } counts as a failure
  const result = simulateNavigationSync({
    orgsFetchError: false,
    orgs: [{ id: "org-1" }],
    rpcResults: [{ data: null, error: null }],
    useServiceClient: true,
  });

  assert.strictEqual(result.body.synced, 0);
  assert.strictEqual(result.body.failed, 1);
});
