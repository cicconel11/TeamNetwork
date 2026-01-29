import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  createMockCheckoutSession,
} from "../../utils/stripeMock.ts";
import {
  DevAdminContext,
  canDevAdminPerform,
  DevAdminPresets,
} from "../../utils/devAdminMock.ts";

/**
 * Tests for organization subscription routes:
 * - GET /api/organizations/[orgId]/subscription
 * - POST /api/organizations/[orgId]/subscription (update alumni bucket)
 * - POST /api/organizations/[orgId]/cancel-subscription
 * - POST /api/organizations/[orgId]/resume-subscription
 * - POST /api/organizations/[orgId]/reconcile-subscription
 * - POST /api/organizations/[orgId]/start-checkout
 */

// Types
interface SubscriptionRequest {
  auth: AuthContext;
  organizationId?: string;
  alumniBucket?: string;
  interval?: "month" | "year";
}

interface SubscriptionResult {
  status: number;
  bucket?: string;
  alumniLimit?: number | null;
  alumniCount?: number;
  remaining?: number | null;
  subscriptionStatus?: string;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  currentPeriodEnd?: string | null;
  url?: string;
  message?: string;
  error?: string;
}

interface SubscriptionContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  subscription?: {
    organization_id: string;
    status: string;
    alumni_bucket: string;
    base_plan_interval: string;
    stripe_subscription_id?: string | null;
    stripe_customer_id?: string | null;
    current_period_end?: string | null;
  };
  alumniCount?: number;
  devAdmin?: DevAdminContext;
}

// Alumni bucket limits mapping
const bucketLimits: Record<string, number | null> = {
  "none": 0,
  "0-250": 250,
  "251-500": 500,
  "501-1000": 1000,
  "1001-2500": 2500,
  "2500-5000": 5000,
  "5000+": null,
};

// ==============================================================
// GET /api/organizations/[orgId]/subscription
// ==============================================================

function simulateGetSubscription(
  request: SubscriptionRequest,
  ctx: SubscriptionContext
): SubscriptionResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  // Check admin role (or nav edit permissions for alumni page)
  const isAdmin = isOrgAdmin(request.auth, request.organizationId);
  // For simplicity, assume non-admins can view if they're members (with limited data)
  const hasMembership = request.auth.memberships.some(
    (m) => m.organization_id === request.organizationId && m.status === "active"
  );

  if (!isAdmin && !hasMembership) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.subscription) {
    return { status: 500, error: "Unable to load subscription details" };
  }

  const bucket = ctx.subscription.alumni_bucket || "none";
  const alumniLimit = bucketLimits[bucket] ?? 0;
  const alumniCount = ctx.alumniCount ?? 0;
  const remaining = alumniLimit === null ? null : Math.max(alumniLimit - alumniCount, 0);

  const result: SubscriptionResult = {
    status: 200,
    bucket,
    alumniLimit,
    alumniCount,
    remaining,
    subscriptionStatus: ctx.subscription.status,
  };

  // Admin gets more details
  if (isAdmin) {
    result.stripeSubscriptionId = ctx.subscription.stripe_subscription_id || null;
    result.stripeCustomerId = ctx.subscription.stripe_customer_id || null;
    result.currentPeriodEnd = ctx.subscription.current_period_end || null;
  }

  return result;
}

test("GET subscription requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetSubscription(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    {
      supabase,
      subscription: {
        organization_id: "org-1",
        status: "active",
        alumni_bucket: "0-250",
        base_plan_interval: "month",
      },
    }
  );
  assert.strictEqual(result.status, 401);
});

test("GET subscription requires organization membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetSubscription(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1" },
    {
      supabase,
      subscription: {
        organization_id: "org-1",
        status: "active",
        alumni_bucket: "0-250",
        base_plan_interval: "month",
      },
    }
  );
  assert.strictEqual(result.status, 403);
});

test("GET subscription returns quota info for admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        organization_id: "org-1",
        status: "active",
        alumni_bucket: "0-250",
        base_plan_interval: "month",
        stripe_subscription_id: "sub_test123",
        stripe_customer_id: "cus_test123",
      },
      alumniCount: 100,
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.bucket, "0-250");
  assert.strictEqual(result.alumniLimit, 250);
  assert.strictEqual(result.alumniCount, 100);
  assert.strictEqual(result.remaining, 150);
  assert.strictEqual(result.stripeSubscriptionId, "sub_test123");
});

test("GET subscription hides Stripe details for non-admin members", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetSubscription(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        organization_id: "org-1",
        status: "active",
        alumni_bucket: "0-250",
        base_plan_interval: "month",
        stripe_subscription_id: "sub_test123",
        stripe_customer_id: "cus_test123",
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.stripeSubscriptionId, undefined);
  assert.strictEqual(result.stripeCustomerId, undefined);
});

// ==============================================================
// POST /api/organizations/[orgId]/cancel-subscription
// ==============================================================

interface CancelRequest {
  auth: AuthContext;
  organizationId?: string;
}

interface CancelResult {
  status: number;
  subscriptionStatus?: string;
  currentPeriodEnd?: string | null;
  message?: string;
  error?: string;
}

interface CancelContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  subscription?: {
    stripe_subscription_id: string | null;
    status: string;
    current_period_end?: string | null;
  };
}

function simulateCancelSubscription(
  request: CancelRequest,
  ctx: CancelContext
): CancelResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  if (!isOrgAdmin(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.subscription) {
    return { status: 404, error: "Subscription not found" };
  }

  // Simulate Stripe update
  const currentPeriodEnd = ctx.subscription.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    status: 200,
    subscriptionStatus: "canceling",
    currentPeriodEnd,
    message: "Subscription will be cancelled at the end of the billing period",
  };
}

test("cancel-subscription requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateCancelSubscription(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "active" } }
  );
  assert.strictEqual(result.status, 401);
});

test("cancel-subscription requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateCancelSubscription(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "active" } }
  );
  assert.strictEqual(result.status, 403);
});

test("cancel-subscription returns 404 for missing subscription", () => {
  const supabase = createSupabaseStub();
  const result = simulateCancelSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, subscription: undefined }
  );
  assert.strictEqual(result.status, 404);
});

test("cancel-subscription schedules cancellation successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulateCancelSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "active" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.subscriptionStatus, "canceling");
  assert.ok(result.message?.includes("end of the billing period"));
});

// ==============================================================
// POST /api/organizations/[orgId]/resume-subscription
// ==============================================================

interface ResumeRequest {
  auth: AuthContext;
  organizationId?: string;
}

interface ResumeResult {
  status: number;
  subscriptionStatus?: string;
  message?: string;
  error?: string;
}

interface ResumeContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  subscription?: {
    stripe_subscription_id: string | null;
    status: string;
  };
}

function simulateResumeSubscription(
  request: ResumeRequest,
  ctx: ResumeContext
): ResumeResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  if (!isOrgAdmin(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.subscription) {
    return { status: 404, error: "Subscription not found" };
  }

  if (ctx.subscription.status !== "canceling") {
    return { status: 400, error: "Subscription is not scheduled for cancellation" };
  }

  if (!ctx.subscription.stripe_subscription_id) {
    return { status: 400, error: "No Stripe subscription to resume" };
  }

  return {
    status: 200,
    subscriptionStatus: "active",
    message: "Subscription resumed successfully",
  };
}

test("resume-subscription requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateResumeSubscription(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "canceling" } }
  );
  assert.strictEqual(result.status, 401);
});

test("resume-subscription requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateResumeSubscription(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "canceling" } }
  );
  assert.strictEqual(result.status, 403);
});

test("resume-subscription requires canceling status", () => {
  const supabase = createSupabaseStub();
  const result = simulateResumeSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "active" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Subscription is not scheduled for cancellation");
});

test("resume-subscription requires Stripe subscription ID", () => {
  const supabase = createSupabaseStub();
  const result = simulateResumeSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: null, status: "canceling" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "No Stripe subscription to resume");
});

test("resume-subscription resumes successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulateResumeSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: "sub_123", status: "canceling" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.subscriptionStatus, "active");
});

// ==============================================================
// POST /api/organizations/[orgId]/reconcile-subscription
// ==============================================================

interface ReconcileRequest {
  auth: AuthContext;
  organizationId?: string;
}

interface ReconcileResult {
  status: number;
  subscriptionStatus?: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  error?: string;
}

interface ReconcileContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  subscription?: {
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    status: string;
    current_period_end?: string | null;
  };
  paymentAttempt?: {
    stripe_checkout_session_id: string;
    status: string;
  };
  devAdmin?: DevAdminContext;
}

function simulateReconcileSubscription(
  request: ReconcileRequest,
  ctx: ReconcileContext
): ReconcileResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  const isAdmin = isOrgAdmin(request.auth, request.organizationId);
  const isDevAdminAllowed = ctx.devAdmin && canDevAdminPerform(ctx.devAdmin, "reconcile_subscription" as never);

  if (!isAdmin && !isDevAdminAllowed) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.subscription) {
    return { status: 404, error: "Subscription not found" };
  }

  // If already has valid Stripe IDs and status, return early
  const validStatuses = ["active", "trialing", "canceling", "past_due", "canceled"];
  if (
    ctx.subscription.stripe_subscription_id &&
    ctx.subscription.stripe_customer_id &&
    validStatuses.includes(ctx.subscription.status) &&
    ctx.subscription.current_period_end
  ) {
    return { status: 200, subscriptionStatus: ctx.subscription.status };
  }

  // If has Stripe subscription ID, fetch from Stripe
  if (ctx.subscription.stripe_subscription_id) {
    return {
      status: 200,
      subscriptionStatus: "active",
      stripeSubscriptionId: ctx.subscription.stripe_subscription_id,
      stripeCustomerId: ctx.subscription.stripe_customer_id || "cus_reconciled",
    };
  }

  // Try payment attempts fallback
  if (!ctx.paymentAttempt?.stripe_checkout_session_id) {
    return { status: 404, error: "No completed checkout session found for this organization." };
  }

  return {
    status: 200,
    subscriptionStatus: "active",
    stripeSubscriptionId: "sub_reconciled",
    stripeCustomerId: "cus_reconciled",
  };
}

test("reconcile-subscription requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: null, stripe_customer_id: null, status: "pending" } }
  );
  assert.strictEqual(result.status, 401);
});

test("reconcile-subscription requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    { supabase, subscription: { stripe_subscription_id: null, stripe_customer_id: null, status: "pending" } }
  );
  assert.strictEqual(result.status, 403);
});

test("reconcile-subscription allows dev admin bypass", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1" },
    {
      supabase,
      subscription: { stripe_subscription_id: "sub_123", stripe_customer_id: null, status: "pending" },
      devAdmin: DevAdminPresets.fullAccess(),
    }
  );
  assert.strictEqual(result.status, 200);
});

test("reconcile-subscription returns early for valid subscription", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        stripe_subscription_id: "sub_123",
        stripe_customer_id: "cus_123",
        status: "active",
        current_period_end: "2025-12-31T00:00:00Z",
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.subscriptionStatus, "active");
});

test("reconcile-subscription fetches from Stripe when needed", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        stripe_subscription_id: "sub_123",
        stripe_customer_id: null,
        status: "pending",
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.stripeCustomerId);
});

test("reconcile-subscription falls back to payment attempts", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        stripe_subscription_id: null,
        stripe_customer_id: null,
        status: "pending",
      },
      paymentAttempt: {
        stripe_checkout_session_id: "cs_123",
        status: "succeeded",
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.stripeSubscriptionId);
});

test("reconcile-subscription returns 404 when no checkout found", () => {
  const supabase = createSupabaseStub();
  const result = simulateReconcileSubscription(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      subscription: {
        stripe_subscription_id: null,
        stripe_customer_id: null,
        status: "pending",
      },
    }
  );
  assert.strictEqual(result.status, 404);
});

// ==============================================================
// POST /api/organizations/[orgId]/start-checkout
// ==============================================================

interface CheckoutRequest {
  auth: AuthContext;
  organizationId?: string;
  alumniBucket?: string;
  interval?: "month" | "year";
}

interface CheckoutResult {
  status: number;
  url?: string;
  mode?: string;
  message?: string;
  error?: string;
}

interface CheckoutContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    slug: string;
    name: string;
  };
}

function simulateStartCheckout(
  request: CheckoutRequest,
  ctx: CheckoutContext
): CheckoutResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  if (!isOrgAdmin(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  const bucket = request.alumniBucket || "none";

  // 5000+ requires sales contact
  if (bucket === "5000+") {
    return {
      status: 200,
      mode: "sales",
      message: "Custom pricing required. Our team will reach out.",
    };
  }

  // Create checkout session
  const session = createMockCheckoutSession({
    metadata: {
      organization_id: ctx.organization.id,
      alumni_bucket: bucket,
    },
  });

  return { status: 200, url: session.url };
}

test("start-checkout requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    { supabase, organization: { id: "org-1", slug: "test-org", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 401);
});

test("start-checkout requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1", slug: "test-org", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 403);
});

test("start-checkout returns 404 for non-existent org", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, organization: undefined }
  );
  assert.strictEqual(result.status, 404);
});

test("start-checkout returns sales mode for 5000+ bucket", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", alumniBucket: "5000+" },
    { supabase, organization: { id: "org-1", slug: "test-org", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "sales");
});

test("start-checkout creates checkout session", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", alumniBucket: "0-250" },
    { supabase, organization: { id: "org-1", slug: "test-org", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.url?.includes("checkout.stripe.com"));
});

test("start-checkout uses default bucket when not specified", () => {
  const supabase = createSupabaseStub();
  const result = simulateStartCheckout(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1", slug: "test-org", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.url);
});
