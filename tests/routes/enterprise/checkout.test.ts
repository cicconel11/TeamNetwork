import test from "node:test";
import assert from "node:assert";
import { z } from "zod";
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
 * Imports real constants, validation schemas, and pricing functions from source
 * to ensure test assertions stay in sync with the actual business rules.
 *
 * Key improvements over the original simulation approach:
 * - Uses real Zod schema (baseSchemas.slug, safeString) matching the route handler
 * - Uses isSalesLed() from pricing.ts instead of hardcoded threshold
 * - Returns "message" (not "error") for sales mode, matching the actual route
 */

import { ALUMNI_BUCKET_PRICING, ENTERPRISE_SEAT_PRICING } from "@/types/enterprise";
import { getBillableOrgCount, isSalesLed } from "@/lib/enterprise/pricing";
import { baseSchemas, safeString } from "@/lib/security/validation";

// ── Validation schema (mirrors the route's createEnterpriseSchema) ──

const createEnterpriseSchema = z
  .object({
    name: safeString(120),
    slug: baseSchemas.slug,
    billingInterval: z.enum(["month", "year"]),
    alumniBucketQuantity: z.number().int().min(1).max(5),
    subOrgQuantity: z.number().int().min(1).max(1000).optional(),
    billingContactEmail: baseSchemas.email,
    description: z.string().trim().max(800).optional(),
  })
  .strict();

// Types (matches new hybrid pricing model)
interface EnterpriseCheckoutRequest {
  auth: AuthContext;
  name: string;
  slug: string;
  billingInterval: "month" | "year";
  alumniBucketQuantity: number;
  subOrgQuantity?: number;
  billingContactEmail: string;
  description?: string;
}

interface EnterpriseCheckoutResult {
  status: number;
  checkoutUrl?: string;
  error?: string;
  message?: string;
  mode?: "subscription" | "sales";
  metadata?: Record<string, string>;
}

interface EnterpriseCheckoutContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  existingEnterpriseSlugs?: string[];
  existingOrgSlugs?: string[];
}

// Simulation function (mirrors actual route logic, using real validation & pricing)
function simulateCreateEnterpriseCheckout(
  request: EnterpriseCheckoutRequest,
  ctx: EnterpriseCheckoutContext
): EnterpriseCheckoutResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Validate using the real Zod schema (same as route)
  const parsed = createEnterpriseSchema.safeParse({
    name: request.name,
    slug: request.slug,
    billingInterval: request.billingInterval,
    alumniBucketQuantity: request.alumniBucketQuantity,
    subOrgQuantity: request.subOrgQuantity,
    billingContactEmail: request.billingContactEmail,
    description: request.description,
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const field = firstIssue?.path[0]?.toString() ?? "body";
    return { status: 400, error: "Invalid request body" };
  }

  const validated = parsed.data;

  // Sales-led check (uses real isSalesLed from pricing.ts)
  if (isSalesLed(validated.alumniBucketQuantity)) {
    return {
      status: 200,
      mode: "sales",
      message: "Enterprise plans with more than 4 alumni buckets (10,000+ alumni) require custom pricing. Please contact sales.",
    };
  }

  // Check if enterprises table query would fail
  const enterprisesError = (ctx.supabase as any).getError("enterprises");
  if (enterprisesError) {
    return { status: 500, error: "Unable to validate slug availability" };
  }

  // Check slug uniqueness against enterprises
  const existingEnterpriseSlugs = ctx.existingEnterpriseSlugs || [];
  if (existingEnterpriseSlugs.includes(validated.slug)) {
    return { status: 409, error: "Slug is already taken" };
  }

  // Check if organizations table query would fail
  const orgsError = (ctx.supabase as any).getError("organizations");
  if (orgsError) {
    return { status: 500, error: "Unable to validate slug availability" };
  }

  // Check slug uniqueness against organizations
  const existingOrgSlugs = ctx.existingOrgSlugs || [];
  if (existingOrgSlugs.includes(validated.slug)) {
    return { status: 409, error: "Slug is already taken" };
  }

  // Build metadata (matches actual route, using real getBillableOrgCount)
  const totalOrgs = validated.subOrgQuantity ?? ENTERPRISE_SEAT_PRICING.freeSubOrgs;

  const metadata: Record<string, string> = {
    type: "enterprise",
    alumni_bucket_quantity: validated.alumniBucketQuantity.toString(),
    sub_org_quantity: totalOrgs.toString(),
    creatorId: request.auth.user!.id,
    enterpriseName: validated.name,
    enterpriseSlug: validated.slug,
    billingContactEmail: validated.billingContactEmail,
    billingInterval: validated.billingInterval,
    enterpriseDescription: validated.description ?? "",
  };

  // Always subscription mode in hybrid model (no $0 path)
  const session = createMockCheckoutSession({
    mode: "subscription",
    metadata,
  });

  return {
    status: 200,
    checkoutUrl: session.url,
    mode: "subscription",
    metadata,
  };
}

// ── Authentication Tests ──

test("create-enterprise-checkout requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.unauthenticated,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
  assert.strictEqual(result.error, "Unauthorized");
});

// ── Name Validation Tests ──

test("create-enterprise-checkout validates enterprise name - empty rejected", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout validates enterprise name - too long", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "A".repeat(121),
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

// ── Slug Validation Tests ──

test("create-enterprise-checkout validates slug format (uses real baseSchemas.slug)", () => {
  const supabase = createSupabaseStub();
  // baseSchemas.slug applies .trim().toLowerCase() then regex /^[a-z0-9-]{3,64}$/
  // So uppercase is normalized (not rejected), but too-short/long/spaces are invalid
  const invalidSlugs = [
    "ab",              // too short (< 3)
    "test enterprise", // spaces
    "a".repeat(65),    // too long (> 64)
  ];

  for (const slug of invalidSlugs) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug,
        billingInterval: "month",
        alumniBucketQuantity: 1,
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 400, `Slug "${slug}" should be invalid`);
  }
});

test("create-enterprise-checkout normalizes uppercase slugs via baseSchemas.slug", () => {
  const supabase = createSupabaseStub();
  // baseSchemas.slug applies .toLowerCase() — uppercase slugs are accepted and normalized
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "Test-Enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200, "Uppercase slugs should be normalized and accepted");
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
        billingInterval: "month",
        alumniBucketQuantity: 1,
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
      billingInterval: "month",
      alumniBucketQuantity: 1,
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
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase, existingOrgSlugs: ["existing-org"] }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.error, "Slug is already taken");
});

// ── Billing Interval Validation Tests ──

test("create-enterprise-checkout validates billing interval", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "weekly" as "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout accepts all valid billing intervals", () => {
  const supabase = createSupabaseStub();

  for (const interval of ["month", "year"] as const) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: `test-enterprise-${interval}`,
        billingInterval: interval,
        alumniBucketQuantity: 1,
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Interval "${interval}" should be valid`);
  }
});

// ── Alumni Bucket Quantity Validation Tests ──

test("create-enterprise-checkout validates alumniBucketQuantity - minimum 1", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 0,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout validates alumniBucketQuantity - negative rejected", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: -1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout validates alumniBucketQuantity - non-integer rejected", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1.5,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout validates alumniBucketQuantity - 6 rejected (above max 5)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 6,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});

test("create-enterprise-checkout returns sales mode for 5 buckets (uses isSalesLed)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Large Enterprise",
      slug: "large-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 5,
      billingContactEmail: "billing@large.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "sales");
  assert.ok(result.message?.includes("custom pricing"));
  assert.ok(result.message?.includes("contact sales"));
});

test("create-enterprise-checkout accepts bucket quantities 1-4", () => {
  const supabase = createSupabaseStub();

  for (let quantity = 1; quantity <= ALUMNI_BUCKET_PRICING.maxSelfServeBuckets; quantity++) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: `test-enterprise-bucket-${quantity}`,
        billingInterval: "month",
        alumniBucketQuantity: quantity,
        billingContactEmail: "billing@test.com",
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Bucket quantity ${quantity} should be valid`);
    assert.strictEqual(result.mode, "subscription");
    assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
  }
});

// ── Email Validation Tests ──

test("create-enterprise-checkout validates billing contact email", () => {
  const supabase = createSupabaseStub();
  const invalidEmails = ["not-an-email", "@nodomain.com", ""];

  for (const email of invalidEmails) {
    const result = simulateCreateEnterpriseCheckout(
      {
        auth: AuthPresets.authenticatedNoOrg,
        name: "Test Enterprise",
        slug: "test-enterprise",
        billingInterval: "month",
        alumniBucketQuantity: 1,
        billingContactEmail: email,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 400, `Email "${email}" should be invalid`);
  }
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
        billingInterval: "month",
        alumniBucketQuantity: 1,
        billingContactEmail: email,
      },
      { supabase }
    );

    assert.strictEqual(result.status, 200, `Email "${email}" should be valid`);
  }
});

// ── Successful Checkout Tests ──

test("create-enterprise-checkout returns checkout URL for bucket 1 (0-2,500 alumni)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
});

test("create-enterprise-checkout returns checkout URL for bucket 4 (7,501-10,000 alumni)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Large Enterprise",
      slug: "large-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 4,
      billingContactEmail: "billing@large.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
});

test("create-enterprise-checkout always uses subscription mode (no $0 path)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Minimum Enterprise",
      slug: "minimum-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.ok(result.checkoutUrl);
});

test("create-enterprise-checkout accepts optional description", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
      description: "A great enterprise for managing alumni networks.",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
  assert.strictEqual(result.metadata?.enterpriseDescription, "A great enterprise for managing alumni networks.");
});

// ── Sub-Org Quantity Tests ──

test("create-enterprise-checkout defaults to freeSubOrgs when not provided", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Default Orgs Enterprise",
      slug: "default-orgs-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.metadata?.sub_org_quantity, ENTERPRISE_SEAT_PRICING.freeSubOrgs.toString());
});

test("create-enterprise-checkout passes subOrgQuantity when provided", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Many Orgs Enterprise",
      slug: "many-orgs-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 2,
      billingContactEmail: "billing@test.com",
      subOrgQuantity: 8,
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.metadata?.sub_org_quantity, "8");
});

test("create-enterprise-checkout with freeSubOrgs orgs (all within free tier)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Free Tier Enterprise",
      slug: "free-tier-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
      subOrgQuantity: ENTERPRISE_SEAT_PRICING.freeSubOrgs,
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.ok(result.checkoutUrl?.includes("checkout.stripe.com"));
  assert.strictEqual(getBillableOrgCount(ENTERPRISE_SEAT_PRICING.freeSubOrgs), 0);
});

test("create-enterprise-checkout with 4 orgs (1 billable)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Small Paid Enterprise",
      slug: "small-paid-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
      subOrgQuantity: 4,
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.strictEqual(getBillableOrgCount(4), 1);
});

test("create-enterprise-checkout with 10 orgs (7 billable)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Medium Enterprise",
      slug: "medium-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 3,
      billingContactEmail: "billing@test.com",
      subOrgQuantity: 10,
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.strictEqual(getBillableOrgCount(10), 7);
});

test("create-enterprise-checkout with 1 org (minimum, within free tier)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Single Org Enterprise",
      slug: "single-org-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
      subOrgQuantity: 1,
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.mode, "subscription");
  assert.strictEqual(getBillableOrgCount(1), 0);
});

// ── Metadata Tests ──

test("create-enterprise-checkout passes correct metadata", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Metadata Enterprise",
      slug: "metadata-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 2,
      billingContactEmail: "billing@metadata.com",
      subOrgQuantity: 5,
      description: "Test description",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.metadata);
  assert.strictEqual(result.metadata.type, "enterprise");
  assert.strictEqual(result.metadata.alumni_bucket_quantity, "2");
  assert.strictEqual(result.metadata.sub_org_quantity, "5");
  assert.strictEqual(result.metadata.enterpriseName, "Metadata Enterprise");
  assert.strictEqual(result.metadata.enterpriseSlug, "metadata-enterprise");
  assert.strictEqual(result.metadata.billingContactEmail, "billing@metadata.com");
  assert.strictEqual(result.metadata.billingInterval, "year");
  assert.strictEqual(result.metadata.enterpriseDescription, "Test description");
});

test("create-enterprise-checkout metadata includes creator ID", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Creator Enterprise",
      slug: "creator-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.ok(result.metadata?.creatorId);
  assert.strictEqual(result.metadata.creatorId, AuthPresets.authenticatedNoOrg.user!.id);
});

test("create-enterprise-checkout metadata has empty description when not provided", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "No Desc Enterprise",
      slug: "no-desc-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.metadata?.enterpriseDescription, "");
});

// ── User Role Tests ──

test("create-enterprise-checkout works for authenticated users without org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "New Enterprise",
      slug: "new-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 2,
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
      billingInterval: "month",
      alumniBucketQuantity: 1,
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
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "member@enterprise.com",
    },
    { supabase }
  );

  // Anyone authenticated can start enterprise checkout
  assert.strictEqual(result.status, 200);
  assert.ok(result.checkoutUrl);
});

// ── Database Error Tests ──

test("create-enterprise-checkout returns 500 if enterprises table query fails", () => {
  const supabase = createSupabaseStub();
  supabase.simulateError("enterprises", { code: "DB_ERROR", message: "Database connection failed" });

  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Unable to validate slug availability"));
});

test("create-enterprise-checkout returns 500 if organizations table query fails", () => {
  const supabase = createSupabaseStub();
  supabase.simulateError("organizations", { code: "DB_ERROR", message: "Database connection failed" });

  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Test Enterprise",
      slug: "test-enterprise",
      billingInterval: "month",
      alumniBucketQuantity: 1,
      billingContactEmail: "billing@test.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 500);
  assert.ok(result.error?.includes("Unable to validate slug availability"));
});

// ── Billable Org Count Calculation Tests (using real function) ──

test("getBillableOrgCount returns 0 for orgs within free tier", () => {
  assert.strictEqual(getBillableOrgCount(1), 0);
  assert.strictEqual(getBillableOrgCount(2), 0);
  assert.strictEqual(getBillableOrgCount(ENTERPRISE_SEAT_PRICING.freeSubOrgs), 0);
});

test("getBillableOrgCount returns correct count for orgs beyond free tier", () => {
  assert.strictEqual(getBillableOrgCount(4), 1);
  assert.strictEqual(getBillableOrgCount(5), 2);
  assert.strictEqual(getBillableOrgCount(10), 7);
  assert.strictEqual(getBillableOrgCount(100), 97);
});

// ── Combined Pricing Example Tests (using real constants) ──

test("pricing example: 3 teams, 2,500 alumni -> $50/mo (bucket 1, 0 billable orgs)", () => {
  const bucketQuantity = 1;
  const totalOrgs = ENTERPRISE_SEAT_PRICING.freeSubOrgs;
  const billableOrgs = getBillableOrgCount(totalOrgs);

  const alumniCostMonthly = bucketQuantity * ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket;
  const seatCostMonthly = billableOrgs * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly;
  const totalMonthly = alumniCostMonthly + seatCostMonthly;

  assert.strictEqual(alumniCostMonthly, 5000); // $50
  assert.strictEqual(seatCostMonthly, 0);
  assert.strictEqual(totalMonthly, 5000); // $50/mo
  assert.strictEqual(billableOrgs, 0);
});

test("pricing example: 5 teams, 5,000 alumni -> $130/mo (bucket 2, 2 billable orgs)", () => {
  const bucketQuantity = 2;
  const totalOrgs = 5;
  const billableOrgs = getBillableOrgCount(totalOrgs);

  const alumniCostMonthly = bucketQuantity * ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket;
  const seatCostMonthly = billableOrgs * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly;
  const totalMonthly = alumniCostMonthly + seatCostMonthly;

  assert.strictEqual(alumniCostMonthly, 10000); // $100
  assert.strictEqual(seatCostMonthly, 3000); // $30 (2 x $15)
  assert.strictEqual(totalMonthly, 13000); // $130/mo
  assert.strictEqual(billableOrgs, 2);
});

test("pricing example: 8 teams, 10,000 alumni -> $275/mo (bucket 4, 5 billable orgs)", () => {
  const bucketQuantity = 4;
  const totalOrgs = 8;
  const billableOrgs = getBillableOrgCount(totalOrgs);

  const alumniCostMonthly = bucketQuantity * ALUMNI_BUCKET_PRICING.monthlyCentsPerBucket;
  const seatCostMonthly = billableOrgs * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsMonthly;
  const totalMonthly = alumniCostMonthly + seatCostMonthly;

  assert.strictEqual(alumniCostMonthly, 20000); // $200
  assert.strictEqual(seatCostMonthly, 7500); // $75 (5 x $15)
  assert.strictEqual(totalMonthly, 27500); // $275/mo
  assert.strictEqual(billableOrgs, 5);
});

test("pricing example: yearly discount applies correctly", () => {
  const bucketQuantity = 2;
  const totalOrgs = 5;
  const billableOrgs = getBillableOrgCount(totalOrgs);

  const alumniCostYearly = bucketQuantity * ALUMNI_BUCKET_PRICING.yearlyCentsPerBucket;
  const seatCostYearly = billableOrgs * ENTERPRISE_SEAT_PRICING.pricePerAdditionalCentsYearly;
  const totalYearly = alumniCostYearly + seatCostYearly;

  assert.strictEqual(alumniCostYearly, 100000); // $1,000
  assert.strictEqual(seatCostYearly, 30000); // $300 (2 x $150)
  assert.strictEqual(totalYearly, 130000); // $1,300/yr
});

test("create-enterprise-checkout rejects sentinel value 999 (exceeds schema max 5)", () => {
  const supabase = createSupabaseStub();
  const result = simulateCreateEnterpriseCheckout(
    {
      auth: AuthPresets.authenticatedNoOrg,
      name: "Legacy Enterprise",
      slug: "legacy-enterprise",
      billingInterval: "year",
      alumniBucketQuantity: 999,
      billingContactEmail: "billing@legacy.com",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 400);
});
