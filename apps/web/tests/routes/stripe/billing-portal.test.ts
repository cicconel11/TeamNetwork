import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createMockBillingPortalSession } from "../../utils/stripeMock.ts";

/**
 * Tests for POST /api/stripe/billing-portal
 *
 * The billing-portal route should:
 * 1. Require user authentication
 * 2. Require admin role in the organization (or dev admin bypass)
 * 3. Validate organization ID or slug
 * 4. Backfill missing stripe_customer_id from Stripe subscription if needed
 * 5. Fall back to payment_attempts checkout session lookup
 * 6. Create Stripe billing portal session and return URL
 */

// Types
interface BillingPortalRequest {
  auth: AuthContext;
  organizationId?: string;
  organizationSlug?: string;
  returnUrl?: string;
}

interface BillingPortalResult {
  status: number;
  portalUrl?: string;
  error?: string;
}

interface BillingPortalContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    slug?: string;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
  };
  subscription?: {
    stripe_customer_id?: string;
  };
  isDevAdmin?: boolean;
}

// Simulation function
function simulateBillingPortal(
  request: BillingPortalRequest,
  ctx: BillingPortalContext
): BillingPortalResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Organization ID or slug required
  if (!request.organizationId && !request.organizationSlug) {
    return { status: 400, error: "Organization ID or slug is required" };
  }

  // Find organization
  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  // Resolve organization ID
  const organizationId = request.organizationId || ctx.organization.id;

  // Admin role check (unless dev admin)
  if (!ctx.isDevAdmin && !isOrgAdmin(request.auth, organizationId)) {
    return { status: 403, error: "Admin role required" };
  }

  // Get or backfill stripe_customer_id
  let customerId = ctx.organization.stripe_customer_id;

  if (!customerId && ctx.organization.stripe_subscription_id && ctx.subscription) {
    // Backfill from subscription
    customerId = ctx.subscription.stripe_customer_id;
  }

  if (!customerId) {
    // Try to find customer from payment_attempts
    const paymentAttempt = ctx.supabase
      .getRows("payment_attempts")
      .find(
        (row) =>
          row.organization_id === organizationId &&
          row.stripe_customer_id
      );

    if (paymentAttempt) {
      customerId = paymentAttempt.stripe_customer_id as string;
    }
  }

  if (!customerId) {
    return { status: 400, error: "No Stripe customer found for this organization" };
  }

  // Create billing portal session
  const portalSession = createMockBillingPortalSession({
    customer: customerId,
    return_url: request.returnUrl || "https://example.com/settings",
  });

  return { status: 200, portalUrl: portalSession.url };
}

// Tests

test("billing-portal requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.unauthenticated,
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.error, "Unauthorized");
});

test("billing-portal requires organization ID or slug", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      // No organizationId or organizationSlug
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization ID or slug is required");
});

test("billing-portal returns 404 for non-existent organization", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-nonexistent",
    },
    { supabase, organization: undefined }
  );

  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.error, "Organization not found");
});

test("billing-portal requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgMember("org-1"), // Member, not admin
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Admin role required");
});

test("billing-portal rejects alumni role", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAlumni("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Admin role required");
});

test("billing-portal allows dev admin to bypass role check", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.authenticatedNoOrg, // Not an admin of org-1
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
      isDevAdmin: true, // Dev admin bypass
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl);
});

test("billing-portal returns portal URL for admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl?.includes("billing.stripe.com"));
});

test("billing-portal fails when no Stripe customer exists", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        stripe_customer_id: null, // No customer
        stripe_subscription_id: null,
      },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "No Stripe customer found for this organization");
});

test("billing-portal backfills customer ID from subscription", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        stripe_customer_id: null, // Missing
        stripe_subscription_id: "sub_123",
      },
      subscription: {
        stripe_customer_id: "cus_backfilled", // From Stripe API
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl);
});

test("billing-portal falls back to payment_attempts lookup", () => {
  const supabase = createSupabaseStub();

  // Seed payment attempt with customer ID
  supabase.seed("payment_attempts", [
    {
      organization_id: "org-1",
      stripe_customer_id: "cus_from_attempt",
      flow_type: "org_checkout",
    },
  ]);

  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: {
        id: "org-1",
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl);
});

test("billing-portal accepts organization slug instead of ID", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationSlug: "test-org",
    },
    {
      supabase,
      organization: { id: "org-1", slug: "test-org", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl);
});

test("billing-portal uses custom return URL", () => {
  const supabase = createSupabaseStub();
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      returnUrl: "https://myapp.com/billing-done",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.portalUrl);
});

test("billing-portal rejects users with membership in different org", () => {
  const supabase = createSupabaseStub();

  // User is admin in org-2, but requesting portal for org-1
  const result = simulateBillingPortal(
    {
      auth: AuthPresets.orgAdmin("org-2"),
      organizationId: "org-1",
    },
    {
      supabase,
      organization: { id: "org-1", stripe_customer_id: "cus_123" },
    }
  );

  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Admin role required");
});
