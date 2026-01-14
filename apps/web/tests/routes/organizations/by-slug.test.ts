import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for GET /api/organizations/by-slug/[slug]
 *
 * This route:
 * 1. Requires user authentication
 * 2. Validates slug format
 * 3. Returns only { id } to minimize data exposure
 * 4. Used by CheckoutSuccessBanner to poll for org creation
 */

// Types
interface BySlugRequest {
  auth: AuthContext;
  slug?: string;
}

interface BySlugResult {
  status: number;
  id?: string;
  error?: string;
}

interface BySlugContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    slug: string;
  };
}

// Slug validation (simplified)
function isValidSlug(slug: string | undefined): boolean {
  if (!slug) return false;
  // Slug should be lowercase alphanumeric with hyphens, 3-50 chars
  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
  return slugRegex.test(slug);
}

function simulateBySlug(
  request: BySlugRequest,
  ctx: BySlugContext
): BySlugResult {
  // Validate slug format first
  if (!request.slug || !isValidSlug(request.slug)) {
    return { status: 400, error: "Invalid slug format" };
  }

  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Find organization by slug
  if (!ctx.organization || ctx.organization.slug !== request.slug) {
    return { status: 404, error: "Organization not found" };
  }

  // Return only the ID
  return { status: 200, id: ctx.organization.id };
}

// Tests

test("by-slug validates slug format", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.orgAdmin("org-1"), slug: "invalid slug with spaces!" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Invalid slug format");
});

test("by-slug rejects empty slug", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.orgAdmin("org-1"), slug: "" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 400);
});

test("by-slug rejects too short slug", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.orgAdmin("org-1"), slug: "ab" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 400);
});

test("by-slug requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.unauthenticated, slug: "test-org" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 401);
});

test("by-slug returns 404 for non-existent slug", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.authenticatedNoOrg, slug: "non-existent-org" },
    { supabase, organization: undefined }
  );
  assert.strictEqual(result.status, 404);
  assert.strictEqual(result.error, "Organization not found");
});

test("by-slug returns only id for existing org", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.authenticatedNoOrg, slug: "test-org" },
    { supabase, organization: { id: "uuid-org-123", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.id, "uuid-org-123");
  // Should not return any other fields
  assert.strictEqual(Object.keys(result).filter((k) => k !== "status" && k !== "id").length, 0);
});

test("by-slug works for any authenticated user (no org membership required)", () => {
  const supabase = createSupabaseStub();
  // User is authenticated but not a member of test-org
  const result = simulateBySlug(
    { auth: AuthPresets.authenticatedNoOrg, slug: "test-org" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.id);
});

test("by-slug handles slug mismatch", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.authenticatedNoOrg, slug: "other-org" },
    { supabase, organization: { id: "org-1", slug: "test-org" } }
  );
  assert.strictEqual(result.status, 404);
});

test("by-slug accepts valid slug format", () => {
  const supabase = createSupabaseStub();
  const result = simulateBySlug(
    { auth: AuthPresets.authenticatedNoOrg, slug: "my-team-2024" },
    { supabase, organization: { id: "org-1", slug: "my-team-2024" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.id, "org-1");
});
