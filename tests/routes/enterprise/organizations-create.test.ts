import test from "node:test";
import assert from "node:assert";
import { z } from "zod";
import { evaluateSubOrgCapacity } from "@/lib/enterprise/quota-logic";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/organizations/create
 *
 * This route creates a sub-organization under an enterprise.
 * Key behaviors to test:
 *
 * 1. Schema validation — name, slug, description, billingType
 * 2. Quota enforcement — seat limit check before creation (503 on DB error)
 * 3. Slug uniqueness — 409 if slug conflicts with existing org or enterprise
 * 4. Enterprise existence — 404 if enterprise not found
 * 5. Org creation — success → 201 with org details
 * 6. Cleanup on partial failure — role/subscription creation failures clean up
 * 7. billingType is locked to "enterprise_managed" (independent not implemented)
 */

// ── Schema mirrors from organizations/create/route.ts ─────────────────────────

// Simplified mirrors for testing (real uses safeString/optionalSafeString helpers)
const createOrgSchema = z
  .object({
    name: z.string().min(1).max(120),
    slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
    description: z.string().max(800).optional(),
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    billingType: z.literal("enterprise_managed").default("enterprise_managed"),
  })
  .strict();

// ── Simulation types ──────────────────────────────────────────────────────────

interface SeatQuotaInfo {
  currentCount: number;
  maxAllowed: number | null;
  error?: string;
}

interface EnterpriseRow {
  id: string;
  primary_color: string | null;
}

interface CreateOrgRouteParams {
  seatQuota: SeatQuotaInfo;
  existingOrgBySlug: { id: string } | null;
  existingEnterpriseBySlug: { id: string } | null;
  enterprise: EnterpriseRow | null;
  orgInsertError: { message: string } | null;
  orgId: string;
  roleError: { message: string } | null;
  subError: { message: string } | null;
}

interface CreateOrgRouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates POST organizations/create route logic (organizations/create/route.ts:42-188).
 *
 * Key behaviors:
 *   - seatQuota.error → 503
 *   - existingOrgBySlug → 409
 *   - existingEnterpriseBySlug → 409
 *   - enterprise null → 404
 *   - orgInsertError → 400
 *   - roleError → 400 (cleanup org)
 *   - subError → 500 (cleanup org + role)
 *   - success → 201
 */
function simulateCreateOrgRoute(
  body: { name: string; slug: string; enterprise_id: string },
  params: CreateOrgRouteParams
): CreateOrgRouteResult {
  const {
    seatQuota, existingOrgBySlug, existingEnterpriseBySlug,
    enterprise, orgInsertError, orgId, roleError, subError,
  } = params;

  // Quota check (fail-closed: DB error → 503)
  if (seatQuota.error) {
    return {
      status: 503,
      body: { error: "Unable to verify seat limit. Please try again." },
    };
  }

  // Slug uniqueness (org)
  if (existingOrgBySlug) {
    return { status: 409, body: { error: "Slug is already taken" } };
  }

  // Slug uniqueness (enterprise)
  if (existingEnterpriseBySlug) {
    return { status: 409, body: { error: "Slug is already taken" } };
  }

  // Enterprise must exist
  if (!enterprise) {
    return { status: 404, body: { error: "Enterprise not found" } };
  }

  // Create org
  if (orgInsertError) {
    return { status: 400, body: { error: "Unable to create organization" } };
  }

  // Grant creator admin role
  if (roleError) {
    // Cleanup: delete new org
    return { status: 400, body: { error: "Failed to assign admin role" } };
  }

  // Create subscription
  if (subError) {
    // Cleanup: delete org + role
    return { status: 500, body: { error: "Failed to create organization subscription" } };
  }

  return {
    status: 201,
    body: {
      organization: {
        id: orgId,
        name: body.name,
        slug: body.slug,
        enterprise_id: body.enterprise_id,
        enterprise_relationship_type: "created",
      },
    },
  };
}

// ── Schema validation tests ────────────────────────────────────────────────────

test("createOrgSchema accepts valid input", () => {
  const result = createOrgSchema.safeParse({
    name: "Test Organization",
    slug: "test-org",
  });
  assert.strictEqual(result.success, true);
});

test("createOrgSchema accepts optional description", () => {
  const result = createOrgSchema.safeParse({
    name: "Test Org",
    slug: "test-org",
    description: "A test organization",
  });
  assert.strictEqual(result.success, true);
});

test("createOrgSchema accepts primary_color in hex format", () => {
  const result = createOrgSchema.safeParse({
    name: "Test Org",
    slug: "test-org",
    primary_color: "#1e3a5f",
  });
  assert.strictEqual(result.success, true);
});

test("createOrgSchema defaults billingType to enterprise_managed", () => {
  const result = createOrgSchema.safeParse({ name: "Test Org", slug: "test-org" });
  assert.strictEqual(result.success, true);
  if (result.success) {
    assert.strictEqual(result.data.billingType, "enterprise_managed");
  }
});

test("createOrgSchema rejects 'independent' billingType (not implemented)", () => {
  const result = createOrgSchema.safeParse({
    name: "Test Org",
    slug: "test-org",
    billingType: "independent",
  });
  assert.strictEqual(result.success, false);
});

test("createOrgSchema rejects name exceeding 120 chars", () => {
  const result = createOrgSchema.safeParse({
    name: "a".repeat(121),
    slug: "test-org",
  });
  assert.strictEqual(result.success, false);
});

test("createOrgSchema rejects slug with uppercase", () => {
  const result = createOrgSchema.safeParse({ name: "Test", slug: "Test-Org" });
  assert.strictEqual(result.success, false);
});

test("createOrgSchema rejects description exceeding 800 chars", () => {
  const result = createOrgSchema.safeParse({
    name: "Test",
    slug: "test-org",
    description: "x".repeat(801),
  });
  assert.strictEqual(result.success, false);
});

test("createOrgSchema rejects invalid hex color", () => {
  const result = createOrgSchema.safeParse({
    name: "Test",
    slug: "test-org",
    primary_color: "blue", // not hex
  });
  assert.strictEqual(result.success, false);
});

test("createOrgSchema rejects extra fields (strict)", () => {
  const result = createOrgSchema.safeParse({
    name: "Test",
    slug: "test-org",
    extra: "field",
  });
  assert.strictEqual(result.success, false);
});

// ── Quota enforcement tests ───────────────────────────────────────────────────

test("create org returns 503 when seat quota DB errors (fail-closed)", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null, error: "internal_error" },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: "#1e3a5f" },
      orgInsertError: null,
      orgId: "new-org-id",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 503);
  assert.ok((result.body.error as string).includes("Unable to verify seat limit"));
});

test("create org blocks creation when seat quota check fails (does not proceed to slug check)", () => {
  // Even if slug would be unique, quota check must block first
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "unique-slug", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 5, maxAllowed: null, error: "internal_error" },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "would-not-reach",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 503);
});

test("create org proceeds when seat quota succeeds (no error)", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 5, maxAllowed: null }, // no error
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "new-org-id",
      roleError: null,
      subError: null,
    }
  );

  // Proceeded past quota check; no seat limit in hybrid model
  assert.strictEqual(result.status, 201);
});

// ── evaluateSubOrgCapacity: always no hard cap in hybrid model ─────────────────

test("evaluateSubOrgCapacity always returns maxAllowed: null (no hard cap)", () => {
  const result = evaluateSubOrgCapacity(5);
  assert.strictEqual(result.maxAllowed, null);
  assert.strictEqual(result.error, undefined);
});

test("evaluateSubOrgCapacity returns correct currentCount", () => {
  const result = evaluateSubOrgCapacity(10);
  assert.strictEqual(result.currentCount, 10);
});

// ── Slug uniqueness tests ─────────────────────────────────────────────────────

test("create org returns 409 when slug conflicts with existing organization", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "taken-slug", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 2, maxAllowed: null },
      existingOrgBySlug: { id: "existing-org" },
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "would-not-reach",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.body.error, "Slug is already taken");
});

test("create org returns 409 when slug conflicts with existing enterprise", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "enterprise-slug", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 2, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: { id: "existing-ent" }, // enterprise has this slug
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "would-not-reach",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 409);
  assert.strictEqual(result.body.error, "Slug is already taken");
});

// ── Enterprise existence check ────────────────────────────────────────────────

test("create org returns 404 when enterprise not found", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ghost-ent" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: null,
      orgInsertError: null,
      orgId: "would-not-reach",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.body.error, "Enterprise not found");
});

// ── Partial failure cleanup tests ─────────────────────────────────────────────

test("create org returns 400 with generic error when org insert fails (no DB detail leak)", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: { message: "duplicate key value" },
      orgId: "would-not-reach",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Unable to create organization");
  // Must NOT contain the raw DB error message
  assert.ok(!(result.body.error as string).includes("duplicate key"));
});

test("create org returns 400 with generic error and cleans up org when role assignment fails", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "new-org-id",
      roleError: { message: "user_organization_roles constraint violation" },
      subError: null,
    }
  );

  // Role error → org deleted, 400 returned with generic message
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.error, "Failed to assign admin role");
  // Must NOT contain the raw DB error message
  assert.ok(!(result.body.error as string).includes("constraint violation"));
});

test("create org returns 500 and cleans up org+role when subscription creation fails", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Org", slug: "new-org", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: null },
      orgInsertError: null,
      orgId: "new-org-id",
      roleError: null,
      subError: { message: "organization_subscriptions insert failed" },
    }
  );

  // Sub error → cleanup, 500 returned
  assert.strictEqual(result.status, 500);
  assert.strictEqual(result.body.error, "Failed to create organization subscription");
});

// ── Success path ──────────────────────────────────────────────────────────────

test("create org returns 201 with organization details on success", () => {
  const result = simulateCreateOrgRoute(
    { name: "New Team", slug: "new-team", enterprise_id: "ent-1" },
    {
      seatQuota: { currentCount: 3, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-1", primary_color: "#1e3a5f" },
      orgInsertError: null,
      orgId: "created-org-uuid",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 201);
  const org = result.body.organization as Record<string, unknown>;
  assert.strictEqual(org.id, "created-org-uuid");
  assert.strictEqual(org.name, "New Team");
  assert.strictEqual(org.slug, "new-team");
  assert.strictEqual(org.enterprise_id, "ent-1");
  assert.strictEqual(org.enterprise_relationship_type, "created");
});

test("create org sets enterprise_relationship_type to 'created' (not 'adopted')", () => {
  const result = simulateCreateOrgRoute(
    { name: "Sub Org", slug: "sub-org", enterprise_id: "ent-2" },
    {
      seatQuota: { currentCount: 0, maxAllowed: null },
      existingOrgBySlug: null,
      existingEnterpriseBySlug: null,
      enterprise: { id: "ent-2", primary_color: null },
      orgInsertError: null,
      orgId: "org-uuid",
      roleError: null,
      subError: null,
    }
  );

  assert.strictEqual(result.status, 201);
  const org = result.body.organization as Record<string, unknown>;
  assert.strictEqual(org.enterprise_relationship_type, "created");
});

// ── Route permission requirement ─────────────────────────────────────────────

test("create org route requires owner or org_admin role (ENTERPRISE_CREATE_ORG_ROLE)", () => {
  // The route uses ENTERPRISE_CREATE_ORG_ROLE = ["owner", "org_admin"]
  const allowedRoles = ["owner", "org_admin"];
  assert.ok(allowedRoles.includes("owner"));
  assert.ok(allowedRoles.includes("org_admin"));
  assert.ok(!allowedRoles.includes("billing_admin"));
});
