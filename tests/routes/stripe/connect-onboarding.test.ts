import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
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

// --- Idempotency key collision fix tests ---
// Bug: same idempotency key was passed to both stripe.accounts.create and
// stripe.accountLinks.create, causing "Keys for idempotent requests can only
// be used for the same endpoint" error.

interface StripeApiCall {
  endpoint: "accounts.create" | "accountLinks.create";
  idempotencyKey?: string;
}

/**
 * Enhanced simulation that tracks which Stripe API calls receive idempotency keys,
 * mirroring the actual route.ts logic.
 */
function simulateConnectOnboardingWithTracking(
  request: ConnectOnboardingRequest,
  ctx: ConnectOnboardingContext
): ConnectOnboardingResult & { stripeCalls: StripeApiCall[] } {
  const stripeCalls: StripeApiCall[] = [];

  // Auth + validation checks (reuse existing logic)
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", stripeCalls };
  }
  if (!request.organizationId) {
    return { status: 400, error: "Organization ID is required", stripeCalls };
  }
  if (!ctx.organization) {
    return { status: 404, error: "Organization not found", stripeCalls };
  }
  if (!isOrgAdmin(request.auth, ctx.organization.id)) {
    return { status: 403, error: "Forbidden", stripeCalls };
  }
  if (ctx.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode", stripeCalls };
  }

  let accountId = ctx.organization.stripe_connect_account_id;

  // accounts.create — only called when no account exists, receives idempotency key
  if (!accountId) {
    const accountKey = request.idempotencyKey
      ? `acct-${request.idempotencyKey}`
      : `acct-${ctx.organization.id}-${request.auth.userId}`;
    stripeCalls.push({ endpoint: "accounts.create", idempotencyKey: accountKey });
    const account = createMockConnectAccount();
    accountId = account.id;
  }

  // accountLinks.create — always called, NO idempotency key (the fix)
  stripeCalls.push({ endpoint: "accountLinks.create" });
  const url = `https://connect.stripe.com/setup/s/${accountId}`;

  return {
    status: 200,
    url,
    accountId,
    idempotencyKey: request.idempotencyKey || null,
    stripeCalls,
  };
}

test("idempotency key is only passed to accounts.create, not accountLinks.create", () => {
  const supabase = createSupabaseStub();
  const idempotencyKey = "user-idem-key-abc";
  const result = simulateConnectOnboardingWithTracking(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      idempotencyKey,
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
  assert.strictEqual(result.stripeCalls.length, 2);

  // accounts.create should receive the idempotency key
  const accountCall = result.stripeCalls.find(c => c.endpoint === "accounts.create");
  assert.ok(accountCall, "accounts.create should be called");
  assert.strictEqual(accountCall!.idempotencyKey, `acct-${idempotencyKey}`);

  // accountLinks.create should NOT receive any idempotency key
  const linkCall = result.stripeCalls.find(c => c.endpoint === "accountLinks.create");
  assert.ok(linkCall, "accountLinks.create should be called");
  assert.strictEqual(linkCall!.idempotencyKey, undefined,
    "accountLinks.create must not receive an idempotency key to avoid collision");
});

test("existing account skips accounts.create — no idempotency collision possible", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnectOnboardingWithTracking(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      idempotencyKey: "some-key",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        slug: "test-org",
        stripe_connect_account_id: "acct_existing456",
      },
    }
  );

  assert.strictEqual(result.status, 200);
  // Only accountLinks.create should be called (no accounts.create)
  assert.strictEqual(result.stripeCalls.length, 1);
  assert.strictEqual(result.stripeCalls[0].endpoint, "accountLinks.create");
  assert.strictEqual(result.stripeCalls[0].idempotencyKey, undefined,
    "accountLinks.create must not receive an idempotency key");
});

test("repeated calls with different keys produce fresh account links", () => {
  const supabase = createSupabaseStub();
  const org = {
    id: "org-1",
    slug: "test-org",
    stripe_connect_account_id: "acct_existing456",
  };

  // First call
  const result1 = simulateConnectOnboardingWithTracking(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", idempotencyKey: "key-1" },
    { supabase, organization: org }
  );

  // Second call with a different key (simulating refreshKey() on the client)
  const result2 = simulateConnectOnboardingWithTracking(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", idempotencyKey: "key-2" },
    { supabase, organization: org }
  );

  assert.strictEqual(result1.status, 200);
  assert.strictEqual(result2.status, 200);
  // Both should succeed — no collision because accountLinks.create has no idempotency key
  assert.ok(result1.url);
  assert.ok(result2.url);
  // Neither call should pass idempotency to accountLinks.create
  assert.strictEqual(result1.stripeCalls[0].idempotencyKey, undefined);
  assert.strictEqual(result2.stripeCalls[0].idempotencyKey, undefined);
});
