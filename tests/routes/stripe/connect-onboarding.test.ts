import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createMockConnectAccount } from "../../utils/stripeMock.ts";

/**
 * Tests for POST /api/stripe/connect-onboarding
 *
 * The connect-onboarding route should:
 * 1. Require user authentication
 * 2. Validate organization ID
 * 3. Require admin role in the organization
 * 4. Check if org is in read-only mode (grace period)
 * 5. Create Stripe Connect account if none exists
 * 6. Generate account link URL for onboarding
 */

// Types
interface ConnectOnboardingRequest {
  auth: AuthContext;
  organizationId?: string;
  idempotencyKey?: string;
}

interface ConnectOnboardingResult {
  status: number;
  url?: string;
  accountId?: string;
  idempotencyKey?: string | null;
  error?: string;
}

interface ConnectOnboardingContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    slug: string;
    stripe_connect_account_id?: string | null;
  };
  isReadOnly?: boolean;
}

// Simulation function
function simulateConnectOnboarding(
  request: ConnectOnboardingRequest,
  ctx: ConnectOnboardingContext
): ConnectOnboardingResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Organization ID required
  if (!request.organizationId) {
    return { status: 400, error: "Organization ID is required" };
  }

  // Find organization
  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  // Admin role check
  if (!isOrgAdmin(request.auth, ctx.organization.id)) {
    return { status: 403, error: "Forbidden" };
  }

  // Check read-only mode
  if (ctx.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode" };
  }

  // Create or use existing account
  let accountId = ctx.organization.stripe_connect_account_id;
  if (!accountId) {
    const account = createMockConnectAccount();
    accountId = account.id;
  }

  // Generate account link
  const url = `https://connect.stripe.com/setup/s/${accountId}`;

  return {
    status: 200,
    url,
    accountId,
    idempotencyKey: request.idempotencyKey || null,
  };
}

// Tests

test("connect-onboarding requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.unauthenticated,
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.error, "Unauthorized");
});

test("connect-onboarding requires organization ID", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      // No organizationId
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization ID is required");
});

test("connect-onboarding returns 404 for non-existent organization", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-nonexistent",
    },
    { supabase, organization: undefined }
  );

  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.error, "Organization not found");
});

test("connect-onboarding requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgMember("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Forbidden");
});

test("connect-onboarding rejects alumni role", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAlumni("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Forbidden");
});

test("connect-onboarding blocks mutations in read-only mode", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
      isReadOnly: true,
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Organization is in read-only mode");
});

test("connect-onboarding creates new account when none exists", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        slug: "test-org",
        stripe_connect_account_id: null,
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.url?.includes("connect.stripe.com"));
  assert.ok(result.accountId?.startsWith("acct_"));
});

test("connect-onboarding uses existing account", () => {
  const supabase = createSupabaseStub();
  const existingAccountId = "acct_existing123";
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        slug: "test-org",
        stripe_connect_account_id: existingAccountId,
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.accountId, existingAccountId);
  assert.ok(result.url?.includes(existingAccountId));
});

test("connect-onboarding accepts idempotency key", () => {
  const supabase = createSupabaseStub();
  const idempotencyKey = "test-idem-key-123";
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      idempotencyKey,
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.idempotencyKey, idempotencyKey);
});

test("connect-onboarding rejects users from different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboarding(
    {
      auth: AuthPresets.orgAdmin("org-2"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Forbidden");
});
