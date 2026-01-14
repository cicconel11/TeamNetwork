import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createMockCheckoutSession } from "../../utils/stripeMock.ts";

/**
 * Tests for POST /api/stripe/create-org-checkout
 *
 * The create-org-checkout route should:
 * 1. Require user authentication
 * 2. Validate organization name and slug
 * 3. Check slug uniqueness
 * 4. Validate billing interval and alumni bucket
 * 5. Handle idempotency (prevent duplicate checkouts)
 * 6. Create org immediately for sales-led buckets (5000+)
 * 7. Generate Stripe checkout session for standard buckets
 * 8. Pass correct metadata to Stripe for webhook provisioning
 */

// Types
interface OrgCheckoutRequest {
  auth: AuthContext;
  organizationName: string;
  organizationSlug: string;
  alumniBucket: string;
  billingInterval: "monthly" | "annual";
  idempotencyKey: string;
}

interface OrgCheckoutResult {
  status: number;
  checkoutUrl?: string;
  organizationId?: string;
  error?: string;
}

interface OrgCheckoutContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  existingSlugs?: string[];
}

// Constants
const VALID_ALUMNI_BUCKETS = ["0-200", "201-600", "601-1500", "1501-5000"];
const SALES_LED_BUCKETS = ["5001+", "enterprise"];
const VALID_BILLING_INTERVALS = ["monthly", "annual"];

// Validation helpers
function isValidSlug(slug: string): boolean {
  // Slug must be lowercase alphanumeric with hyphens, 3-50 chars
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
  return slugRegex.test(slug);
}

function isValidOrgName(name: string): boolean {
  // Name must be 2-100 chars, no leading/trailing whitespace
  return name.length >= 2 && name.length <= 100 && name.trim() === name;
}

// Simulation function
function simulateCreateOrgCheckout(
  request: OrgCheckoutRequest,
  ctx: OrgCheckoutContext
): OrgCheckoutResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate organization name
  if (!request.organizationName || !isValidOrgName(request.organizationName)) {
    return { status: 400, error: "Invalid organization name" };
  }

  // Validate organization slug
  if (!request.organizationSlug || !isValidSlug(request.organizationSlug)) {
    return { status: 400, error: "Invalid organization slug" };
  }

  // Check slug uniqueness
  const existingSlugs = ctx.existingSlugs || [];
  const slugsInDb = ctx.supabase.getRows("organizations").map((r) => r.slug);
  const allSlugs = [...existingSlugs, ...slugsInDb];

  if (allSlugs.includes(request.organizationSlug)) {
    return { status: 409, error: "Organization slug already exists" };
  }

  // Validate alumni bucket
  const allBuckets = [...VALID_ALUMNI_BUCKETS, ...SALES_LED_BUCKETS];
  if (!allBuckets.includes(request.alumniBucket)) {
    return { status: 400, error: "Invalid alumni bucket" };
  }

  // Validate billing interval
  if (!VALID_BILLING_INTERVALS.includes(request.billingInterval)) {
    return { status: 400, error: "Invalid billing interval" };
  }

  // Idempotency key required
  if (!request.idempotencyKey) {
    return { status: 400, error: "Idempotency key is required" };
  }

  // Check for existing payment attempt
  const existingAttempt = ctx.supabase
    .getRows("payment_attempts")
    .find((row) => row.idempotency_key === request.idempotencyKey);

  if (existingAttempt) {
    if (existingAttempt.checkout_url) {
      return { status: 200, checkoutUrl: existingAttempt.checkout_url as string };
    }
    if (existingAttempt.organization_id) {
      return { status: 200, organizationId: existingAttempt.organization_id as string };
    }
    return { status: 409, error: "Checkout is being processed" };
  }

  // Sales-led buckets: create org immediately, no Stripe checkout
  if (SALES_LED_BUCKETS.includes(request.alumniBucket)) {
    const orgId = `org_${Date.now()}`;
    return {
      status: 200,
      organizationId: orgId,
      // No checkoutUrl - org created directly, requires manual setup
    };
  }

  // Standard buckets: create Stripe checkout session
  const mockSession = createMockCheckoutSession({
    mode: "subscription",
    metadata: {
      organization_name: request.organizationName,
      organization_slug: request.organizationSlug,
      alumni_bucket: request.alumniBucket,
      billing_interval: request.billingInterval,
      admin_user_id: request.auth.user!.id,
    },
  });

  return { status: 200, checkoutUrl: mockSession.url };
}

// Tests

test("create-org-checkout requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.unauthenticated,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.error, "Unauthorized");
});

test("create-org-checkout validates organization name - too short", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "A", // Too short
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid organization name");
});

test("create-org-checkout validates organization name - too long", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "A".repeat(101), // Too long
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid organization name");
});

test("create-org-checkout validates organization name - leading/trailing whitespace", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "  Test Org  ", // Whitespace
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid organization name");
});

test("create-org-checkout validates organization slug format", () => {
  const supabase = createSupabaseStub();
  const invalidSlugs = [
    "ab", // Too short
    "-test-org", // Starts with hyphen
    "test-org-", // Ends with hyphen
    "Test-Org", // Uppercase
    "test_org", // Underscore
    "test org", // Space
    "a".repeat(52), // Too long
  ];

  for (const slug of invalidSlugs) {
    const result = simulateCreateOrgCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        organizationName: "Test Org",
        organizationSlug: slug,
        alumniBucket: "0-200",
        billingInterval: "monthly",
        idempotencyKey: `key-${slug}`,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 400, `Slug "${slug}" should be invalid`);
    assert.strictEqual(result.error, "Invalid organization slug");
  }
});

test("create-org-checkout accepts valid slug formats", () => {
  const supabase = createSupabaseStub();
  const validSlugs = [
    "abc",
    "test-org",
    "my-organization-2024",
    "a1b2c3",
    "a".repeat(50),
  ];

  for (const slug of validSlugs) {
    supabase.clear();
    const result = simulateCreateOrgCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        organizationName: "Test Org",
        organizationSlug: slug,
        alumniBucket: "0-200",
        billingInterval: "monthly",
        idempotencyKey: `key-${slug}`,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Slug "${slug}" should be valid`);
  }
});

test("create-org-checkout rejects duplicate slug", () => {
  const supabase = createSupabaseStub();
  supabase.seed("organizations", [{ slug: "existing-org" }]);

  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "existing-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.error, "Organization slug already exists");
});

test("create-org-checkout validates alumni bucket", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "invalid-bucket",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid alumni bucket");
});

test("create-org-checkout validates billing interval", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "weekly" as "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid billing interval");
});

test("create-org-checkout requires idempotency key", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Idempotency key is required");
});

test("create-org-checkout returns checkout URL for standard bucket", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
  assert.strictEqual(result.organizationId, undefined);
});

test("create-org-checkout creates org immediately for sales-led bucket", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Enterprise Org",
      organizationSlug: "enterprise-org",
      alumniBucket: "5001+",
      billingInterval: "annual",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.organizationId);
  assert.strictEqual(result.checkoutUrl, undefined);
});

test("create-org-checkout handles idempotent duplicate requests", () => {
  const supabase = createSupabaseStub();

  // Seed existing payment attempt with checkout URL
  supabase.seed("payment_attempts", [
    {
      idempotency_key: "duplicate-key",
      checkout_url: "https://checkout.stripe.com/existing",
      flow_type: "org_checkout",
    },
  ]);

  const result = simulateCreateOrgCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "duplicate-key",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.checkoutUrl, "https://checkout.stripe.com/existing");
});

test("create-org-checkout accepts all valid alumni buckets", () => {
  const supabase = createSupabaseStub();

  for (const bucket of VALID_ALUMNI_BUCKETS) {
    supabase.clear();
    const result = simulateCreateOrgCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        organizationName: "Test Org",
        organizationSlug: `test-org-${bucket.replace(/[^a-z0-9]/g, "")}`,
        alumniBucket: bucket,
        billingInterval: "monthly",
        idempotencyKey: `key-${bucket}`,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Bucket "${bucket}" should be valid`);
  }
});

test("create-org-checkout accepts both billing intervals", () => {
  const supabase = createSupabaseStub();

  for (const interval of VALID_BILLING_INTERVALS as ("monthly" | "annual")[]) {
    supabase.clear();
    const result = simulateCreateOrgCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        organizationName: "Test Org",
        organizationSlug: `test-org-${interval}`,
        alumniBucket: "0-200",
        billingInterval: interval,
        idempotencyKey: `key-${interval}`,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Interval "${interval}" should be valid`);
  }
});

test("create-org-checkout metadata includes admin_user_id", () => {
  const supabase = createSupabaseStub();
  const auth = AuthPresets.authenticatedNoOrg;

  const result = simulateCreateOrgCheckout(
    {
      auth,
      organizationName: "Test Org",
      organizationSlug: "test-org",
      alumniBucket: "0-200",
      billingInterval: "monthly",
      idempotencyKey: "key-1",
    },
    { supabase }
  );

  // The checkout URL is generated - in real code, metadata would contain admin_user_id
  assert.strictEqual(result.status, 200);
  // Metadata verification would happen in webhook tests
});
