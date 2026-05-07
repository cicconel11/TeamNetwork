import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  DevAdminContext,
  DevAdminPresets,
} from "../../utils/devAdminMock.ts";

/**
 * Tests for GET /api/dev-admin/organizations
 *
 * This route:
 * 1. Requires dev-admin access (not regular admin)
 * 2. Returns all organizations with subscription and member data
 * 3. Logs the admin action
 */

// Types
interface DevAdminOrgsRequest {
  auth: AuthContext;
  devAdmin?: DevAdminContext;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  stripe_connect_account_id: string | null;
  member_count: number;
  subscription: {
    status: string;
    stripe_subscription_id: string | null;
    current_period_end: string | null;
  } | null;
}

interface DevAdminOrgsResult {
  status: number;
  organizations?: Organization[];
  error?: string;
}

interface DevAdminOrgsContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organizations?: Array<{
    id: string;
    name: string;
    slug: string;
    created_at: string;
    stripe_connect_account_id: string | null;
    memberCount: number;
    subscription?: {
      status: string;
      stripe_subscription_id: string | null;
      current_period_end: string | null;
    };
  }>;
}

function simulateDevAdminOrgs(
  request: DevAdminOrgsRequest,
  ctx: DevAdminOrgsContext
): DevAdminOrgsResult {
  // Must be authenticated
  if (!isAuthenticated(request.auth)) {
    return { status: 403, error: "Unauthorized" };
  }

  // Must be dev admin
  if (!request.devAdmin?.isDevAdmin) {
    return { status: 403, error: "Unauthorized" };
  }

  // Return all organizations with member counts
  const organizations = (ctx.organizations || []).map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    created_at: org.created_at,
    stripe_connect_account_id: org.stripe_connect_account_id,
    member_count: org.memberCount,
    subscription: org.subscription || null,
  }));

  return { status: 200, organizations };
}

// Tests

test("dev-admin organizations returns 403 for unauthenticated user", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.unauthenticated },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("dev-admin organizations returns 403 for regular user", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.notDevAdmin() },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("dev-admin organizations returns 403 for org admin (not dev admin)", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.orgAdmin("org-1"), devAdmin: DevAdminPresets.notDevAdmin() },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("dev-admin organizations returns all orgs for dev admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    {
      supabase,
      organizations: [
        {
          id: "org-1",
          name: "Test Org 1",
          slug: "test-org-1",
          created_at: "2024-01-01T00:00:00Z",
          stripe_connect_account_id: null,
          memberCount: 10,
        },
        {
          id: "org-2",
          name: "Test Org 2",
          slug: "test-org-2",
          created_at: "2024-02-01T00:00:00Z",
          stripe_connect_account_id: "acct_123",
          memberCount: 25,
          subscription: {
            status: "active",
            stripe_subscription_id: "sub_123",
            current_period_end: "2024-12-31T00:00:00Z",
          },
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organizations?.length, 2);
});

test("dev-admin organizations includes member counts", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    {
      supabase,
      organizations: [
        {
          id: "org-1",
          name: "Large Org",
          slug: "large-org",
          created_at: "2024-01-01T00:00:00Z",
          stripe_connect_account_id: null,
          memberCount: 150,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organizations?.[0].member_count, 150);
});

test("dev-admin organizations includes subscription data", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    {
      supabase,
      organizations: [
        {
          id: "org-1",
          name: "Subscribed Org",
          slug: "subscribed-org",
          created_at: "2024-01-01T00:00:00Z",
          stripe_connect_account_id: "acct_456",
          memberCount: 50,
          subscription: {
            status: "active",
            stripe_subscription_id: "sub_456",
            current_period_end: "2025-01-01T00:00:00Z",
          },
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organizations?.[0].subscription?.status, "active");
  assert.strictEqual(result.organizations?.[0].subscription?.stripe_subscription_id, "sub_456");
});

test("dev-admin organizations returns null subscription for orgs without subscription", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    {
      supabase,
      organizations: [
        {
          id: "org-1",
          name: "Free Org",
          slug: "free-org",
          created_at: "2024-01-01T00:00:00Z",
          stripe_connect_account_id: null,
          memberCount: 5,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organizations?.[0].subscription, null);
});

test("dev-admin organizations returns empty array when no orgs exist", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    { supabase, organizations: [] }
  );
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.organizations, []);
});

test("dev-admin organizations includes stripe connect account id", () => {
  const supabase = createSupabaseStub();
  const result = simulateDevAdminOrgs(
    { auth: AuthPresets.authenticatedNoOrg, devAdmin: DevAdminPresets.fullAccess() },
    {
      supabase,
      organizations: [
        {
          id: "org-1",
          name: "Connected Org",
          slug: "connected-org",
          created_at: "2024-01-01T00:00:00Z",
          stripe_connect_account_id: "acct_connected123",
          memberCount: 20,
        },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.organizations?.[0].stripe_connect_account_id, "acct_connected123");
});
