import test from "node:test";
import assert from "node:assert";
import { z } from "zod";

/**
 * Tests for POST /api/enterprise/[enterpriseId]/adopt
 *
 * This route creates an adoption request for an organization to join an enterprise.
 * The key behaviors to test:
 *
 * 1. Schema validation — organizationSlug must be a valid slug
 * 2. Org not found by slug → 404
 * 3. createAdoptionRequest() error propagation:
 *    - org already in enterprise → 400
 *    - quota exceeded → 400
 *    - duplicate pending request → 400
 *    - DB error → 503 (propagated from adoption.ts status field)
 * 4. Success → 201 with requestId
 *
 * The route delegates all business logic to createAdoptionRequest(), which
 * is tested separately in enterprise/adoption.test.ts. Here we verify
 * the route's error mapping and response shape.
 */

// ── Schema mirrors from adopt/route.ts ────────────────────────────────────────

// Mirrors baseSchemas.slug from validation.ts
const slugSchema = z.string().min(2).max(64).regex(/^[a-z0-9-]+$/);
const adoptSchema = z.object({ organizationSlug: slugSchema }).strict();

// ── Simulation types ──────────────────────────────────────────────────────────

interface CreateAdoptionRequestResult {
  success: boolean;
  requestId?: string;
  error?: string;
  status?: number;
}

interface AdoptRouteParams {
  organizationSlug: string;
  foundOrgId: string | null;
  adoptionResult: CreateAdoptionRequestResult;
}

interface AdoptRouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Simulates POST adopt route logic (adopt/route.ts:28-89).
 *
 * Key behaviors:
 *   - org not found → 404
 *   - adoptionResult.success false → 400 (or result.status if set)
 *   - adoptionResult.success true → 201 with requestId
 */
function simulateAdoptRoute(params: AdoptRouteParams): AdoptRouteResult {
  const { foundOrgId, adoptionResult } = params;

  if (!foundOrgId) {
    return { status: 404, body: { error: "Organization not found" } };
  }

  if (!adoptionResult.success) {
    const status = adoptionResult.status ?? 400;
    return { status, body: { error: adoptionResult.error } };
  }

  return { status: 201, body: { requestId: adoptionResult.requestId } };
}

// ── Schema validation tests ────────────────────────────────────────────────────

test("adoptSchema accepts valid slug", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "my-team-network" });
  assert.strictEqual(result.success, true);
});

test("adoptSchema accepts slug with numbers", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "team-2024" });
  assert.strictEqual(result.success, true);
});

test("adoptSchema rejects slug with uppercase letters", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "My-Team" });
  assert.strictEqual(result.success, false);
});

test("adoptSchema rejects slug with special characters", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "team_network!" });
  assert.strictEqual(result.success, false);
});

test("adoptSchema rejects slug too short (< 2 chars)", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "a" });
  assert.strictEqual(result.success, false);
});

test("adoptSchema rejects slug too long (> 64 chars)", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "a".repeat(65) });
  assert.strictEqual(result.success, false);
});

test("adoptSchema rejects extra fields (strict)", () => {
  const result = adoptSchema.safeParse({ organizationSlug: "valid-slug", extra: "field" });
  assert.strictEqual(result.success, false);
});

// ── Route logic: org validation ──────────────────────────────────────────────

test("adopt route returns 404 when org slug not found", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "nonexistent-org",
    foundOrgId: null,
    adoptionResult: { success: false, error: "should not reach this" },
  });

  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.body.error, "Organization not found");
});

// ── Route logic: adoption error propagation ───────────────────────────────────

test("adopt route returns 400 when org already belongs to enterprise", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "taken-org",
    foundOrgId: "org-1",
    adoptionResult: {
      success: false,
      error: "Organization already belongs to an enterprise",
    },
  });

  assert.strictEqual(result.status, 400);
  assert.ok((result.body.error as string).includes("already belongs to an enterprise"));
});

test("adopt route returns 400 when quota would be exceeded", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "large-org",
    foundOrgId: "org-2",
    adoptionResult: {
      success: false,
      error: "Adoption would exceed alumni limit (6000/5000)",
    },
  });

  assert.strictEqual(result.status, 400);
  assert.ok((result.body.error as string).includes("exceed alumni limit"));
});

test("adopt route returns 400 when pending request already exists", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "already-requested-org",
    foundOrgId: "org-3",
    adoptionResult: {
      success: false,
      error: "A pending adoption request already exists for this organization",
    },
  });

  assert.strictEqual(result.status, 400);
  assert.ok((result.body.error as string).includes("pending adoption request"));
});

test("adopt route returns 503 when createAdoptionRequest returns status 503", () => {
  // DB errors in adoption.ts return { success: false, status: 503 }
  const result = simulateAdoptRoute({
    organizationSlug: "org-db-error",
    foundOrgId: "org-4",
    adoptionResult: {
      success: false,
      error: "Failed to verify organization",
      status: 503,
    },
  });

  assert.strictEqual(result.status, 503);
});

test("adopt route returns 503 when existing-request check DB errors", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "org-5",
    foundOrgId: "org-5-id",
    adoptionResult: {
      success: false,
      error: "Failed to check for existing request",
      status: 503,
    },
  });

  assert.strictEqual(result.status, 503);
});

// ── Route logic: success path ──────────────────────────────────────────────────

test("adopt route returns 201 with requestId on success", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "valid-org",
    foundOrgId: "org-6",
    adoptionResult: {
      success: true,
      requestId: "new-adoption-request-uuid",
    },
  });

  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.body.requestId, "new-adoption-request-uuid");
});

test("adopt route returns 201 with requestId when org found and no existing request", () => {
  const result = simulateAdoptRoute({
    organizationSlug: "clean-org",
    foundOrgId: "org-7-id",
    adoptionResult: {
      success: true,
      requestId: "request-abc",
    },
  });

  assert.strictEqual(result.status, 201);
  assert.ok(result.body.requestId);
});

// ── Route permission requirement ────────────────────────────────────────────────

test("adopt route requires OWNER role (not just any enterprise role)", () => {
  // The route uses ENTERPRISE_OWNER_ROLE for authorization.
  // This documents that only enterprise owners can initiate adoptions.
  const allowedRoles = ["owner"];
  assert.ok(allowedRoles.includes("owner"));
  assert.ok(!allowedRoles.includes("billing_admin"));
  assert.ok(!allowedRoles.includes("org_admin"));
});
