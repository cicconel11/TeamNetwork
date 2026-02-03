import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { createMockCheckoutSession } from "../../utils/stripeMock.ts";

/**
 * Tests for POST /api/stripe/create-enterprise-checkout
 *
 * The create-enterprise-checkout route should:
 * 1. Require user authentication
 * 2. Validate required fields (name, slug, tier, billingInterval, billingContactEmail)
 * 3. Check slug uniqueness against enterprises and organizations
 * 4. Return error for custom pricing tiers (tier_3, custom)
 * 5. Create Stripe checkout session for valid tiers
 * 6. Pass correct metadata to Stripe for webhook provisioning
 */

// Types
interface EnterpriseCheckoutRequest {
  auth: AuthContext;
  name: string;
  slug: string;
  tier: string;
  billingInterval: "month" | "year";
  billingContactEmail: string;
  description?: string;
}

interface EnterpriseCheckoutResult {
  status: number;
  checkoutUrl?: string;
  error?: string;
}

interface EnterpriseCheckoutContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  existingEnterpriseSlugs?: string[];
  existingOrgSlugs?: string[];
}

// Pricing (matches implementation)
const ENTERPRISE_PRICING: Record<string, { monthly: number; yearly: number } | null> = {
  tier_1: { monthly: 10000, yearly: 100000 },
  tier_2: { monthly: 15000, yearly: 150000 },
  tier_3: null, // custom pricing
  custom: null, // custom pricing
};

const VALID_TIERS = ["tier_1", "tier_2", "tier_3", "custom"];
const VALID_BILLING_INTERVALS = ["month", "year"];

// Validation helpers
function isValidSlug(slug: string): boolean {
  // Slug must be lowercase alphanumeric with hyphens, 3-50 chars
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
  return slugRegex.test(slug);
}

function isValidName(name: string): boolean {
  // Name must be 2-120 chars, no leading/trailing whitespace
  return name.length >= 2 && name.length <= 120 && name.trim() === name;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Simulation function
function simulateCreateEnterpriseCheckout(
  request: EnterpriseCheckoutRequest,
  ctx: EnterpriseCheckoutContext
): EnterpriseCheckoutResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate name
  if (!request.name || !isValidName(request.name)) {
    return { status: 400, error: "Invalid enterprise name" };
  }

  // Validate slug
  if (!request.slug || !isValidSlug(request.slug)) {
    return { status: 400, error: "Invalid enterprise slug" };
  }

  // Check slug uniqueness against enterprises
  const existingEnterpriseSlugs = ctx.existingEnterpriseSlugs || [];
  if (existingEnterpriseSlugs.includes(request.slug)) {
    return { status: 409, error: "Slug is already taken" };
  }

  // Check slug uniqueness against organizations
  const existingOrgSlugs = ctx.existingOrgSlugs || [];
  if (existingOrgSlugs.includes(request.slug)) {
    return { status: 409, error: "Slug is already taken" };
  }

  // Validate tier
  if (!VALID_TIERS.includes(request.tier)) {
    return { status: 400, error: "Invalid tier" };
  }

  // Validate billing interval
  if (!VALID_BILLING_INTERVALS.includes(request.billingInterval)) {
    return { status: 400, error: "Invalid billing interval" };
  }

  // Validate billing contact email
  if (!request.billingContactEmail || !isValidEmail(request.billingContactEmail)) {
    return { status: 400, error: "Invalid billing contact email" };
  }

  // Get pricing for the tier
  const pricing = ENTERPRISE_PRICING[request.tier];
  if (pricing === null) {
    return {
      status: 400,
      error: "This tier requires custom pricing. Please contact sales.",
    };
  }

  // Create checkout session
  const session = createMockCheckoutSession({
    mode: "subscription",
    metadata: {
      type: "enterprise",
      tier: request.tier,
      creatorId: request.auth.user!.id,
      enterpriseName: request.name,
      enterpriseSlug: request.slug,
    },
  });

  return { status: 200, checkoutUrl: session.url };
}

// Tests

test("create-enterprise-checkout requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.unauthenticated,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.error, "Unauthorized");
});

test("create-enterprise-checkout validates enterprise name - too short", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "A", // Too short
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid enterprise name");
});

test("create-enterprise-checkout validates enterprise name - too long", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "A".repeat(121), // Too long
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid enterprise name");
});

test("create-enterprise-checkout validates enterprise name - leading/trailing whitespace", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "  Test Enterprise  ", // Whitespace
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid enterprise name");
});

test("create-enterprise-checkout validates slug format", () => {
  const supabase = createSupabaseStub();
  const invalidSlugs = [
    "ab", // Too short
    "-test-enterprise", // Starts with hyphen
    "test-enterprise-", // Ends with hyphen
    "Test-Enterprise", // Uppercase
    "test_enterprise", // Underscore
    "test enterprise", // Space
    "a".repeat(52), // Too long
  ];

  for (const slug of invalidSlugs) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug,
        tier: "tier_1",
        billingInterval: "month",
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 400, `Slug "${slug}" should be invalid`);
    assert.strictEqual(result.error, "Invalid enterprise slug");
  }
});

test("create-enterprise-checkout accepts valid slug formats", () => {
  const supabase = createSupabaseStub();
  const validSlugs = [
    "abc",
    "test-enterprise",
    "my-company-2024",
    "a1b2c3",
    "a".repeat(50),
  ];

  for (const slug of validSlugs) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug,
        tier: "tier_1",
        billingInterval: "month",
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Slug "${slug}" should be valid`);
  }
});

test("create-enterprise-checkout rejects duplicate enterprise slug", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "existing-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase, existingEnterpriseSlugs: ["existing-enterprise"] }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.error, "Slug is already taken");
});

test("create-enterprise-checkout rejects slug that conflicts with organization", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "existing-org",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase, existingOrgSlugs: ["existing-org"] }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.error, "Slug is already taken");
});

test("create-enterprise-checkout validates tier", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "invalid-tier",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid tier");
});

test("create-enterprise-checkout validates billing interval", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "weekly" as "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid billing interval");
});

test("create-enterprise-checkout validates billing contact email", () => {
  const supabase = createSupabaseStub();
  const invalidEmails = ["not-an-email", "missing@domain", "@nodomain.com", ""];

  for (const email of invalidEmails) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: "test-enterprise",
        tier: "tier_1",
        billingInterval: "month",
        billingContactEmail: email,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 400, `Email "${email}" should be invalid`);
    assert.strictEqual(result.error, "Invalid billing contact email");
  }
});

test("create-enterprise-checkout returns checkout URL for tier_1", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
});

test("create-enterprise-checkout returns checkout URL for tier_2", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "tier_2",
      billingInterval: "year",
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
});

test("create-enterprise-checkout returns error for tier_3 (custom pricing)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Enterprise Corp",
      slug: "enterprise-corp",
      tier: "tier_3",
      billingInterval: "year",
      billingContactEmail: "billing@corp.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("custom pricing"));
  assert.ok(result.error?.includes("contact sales"));
});

test("create-enterprise-checkout returns error for custom tier", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Custom Corp",
      slug: "custom-corp",
      tier: "custom",
      billingInterval: "month",
      billingContactEmail: "billing@custom.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("custom pricing"));
});

test("create-enterprise-checkout accepts all valid billing intervals", () => {
  const supabase = createSupabaseStub();

  for (const interval of VALID_BILLING_INTERVALS as ("month" | "year")[]) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: `test-enterprise-${interval}`,
        tier: "tier_1",
        billingInterval: interval,
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Interval "${interval}" should be valid`);
  }
});

test("create-enterprise-checkout accepts optional description", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "billing@test.com",
      description: "A great enterprise for managing alumni networks.",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("create-enterprise-checkout works with valid email formats", () => {
  const supabase = createSupabaseStub();
  const validEmails = [
    "simple@example.com",
    "user.name@example.com",
    "user+tag@example.com",
    "user@subdomain.example.com",
  ];

  let slugCounter = 0;
  for (const email of validEmails) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: `test-enterprise-${slugCounter++}`,
        tier: "tier_1",
        billingInterval: "month",
        billingContactEmail: email,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Email "${email}" should be valid`);
  }
});

test("create-enterprise-checkout works for authenticated users without org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "New Enterprise",
      slug: "new-enterprise",
      tier: "tier_2",
      billingInterval: "year",
      billingContactEmail: "admin@newenterprise.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("create-enterprise-checkout works for org admins", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      name: "New Enterprise",
      slug: "new-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "admin@enterprise.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

test("create-enterprise-checkout works for org members", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.orgMember("org-1"),
      name: "New Enterprise",
      slug: "new-enterprise",
      tier: "tier_1",
      billingInterval: "month",
      billingContactEmail: "member@enterprise.com",
    },
    { supabase }
  );

  // Anyone authenticated can start enterprise checkout
  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});
