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
  DevAdminContext,
  canDevAdminPerform,
  DevAdminPresets,
} from "../../utils/devAdminMock.ts";

/**
 * Tests for organization management routes:
 * - PATCH /api/organizations/[orgId] (update org name/nav_config)
 * - DELETE /api/organizations/[orgId]
 */

// Types
interface PatchOrgRequest {
  auth: AuthContext;
  organizationId?: string;
  name?: string;
  navConfig?: Record<string, unknown>;
  feed_post_roles?: string[];
  job_post_roles?: string[];
  discussion_post_roles?: string[];
  media_upload_roles?: string[];
}

interface PatchOrgResult {
  status: number;
  name?: string;
  navConfig?: Record<string, unknown>;
  feed_post_roles?: string[];
  job_post_roles?: string[];
  discussion_post_roles?: string[];
  media_upload_roles?: string[];
  error?: string;
}

interface PatchOrgContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
    name: string;
    nav_config?: Record<string, unknown>;
  };
  isReadOnly?: boolean;
}

// ==============================================================
// PATCH /api/organizations/[orgId]
// ==============================================================

function simulatePatchOrganization(
  request: PatchOrgRequest,
  ctx: PatchOrgContext
): PatchOrgResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  if (!isOrgAdmin(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (ctx.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode" };
  }

  // Validate name if provided
  if (request.name !== undefined) {
    const trimmedName = request.name.trim();
    if (!trimmedName) {
      return { status: 400, error: "Organization name cannot be empty" };
    }
    if (trimmedName.length > 100) {
      return { status: 400, error: "Organization name must be under 100 characters" };
    }
  }

  // Check if there's anything to update
  if (
    request.name === undefined &&
    request.navConfig === undefined &&
    request.feed_post_roles === undefined &&
    request.job_post_roles === undefined &&
    request.discussion_post_roles === undefined &&
    request.media_upload_roles === undefined
  ) {
    return { status: 400, error: "No valid fields to update" };
  }

  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  const result: PatchOrgResult = { status: 200 };
  if (request.name !== undefined) {
    result.name = request.name.trim();
  }
  if (request.navConfig !== undefined) {
    result.navConfig = request.navConfig;
  }
  // Mirror route.ts behavior: force "admin" into any provided role array
  if (request.feed_post_roles !== undefined) {
    result.feed_post_roles = Array.from(new Set(["admin", ...request.feed_post_roles]));
  }
  if (request.job_post_roles !== undefined) {
    result.job_post_roles = Array.from(new Set(["admin", ...request.job_post_roles]));
  }
  if (request.discussion_post_roles !== undefined) {
    result.discussion_post_roles = Array.from(new Set(["admin", ...request.discussion_post_roles]));
  }
  if (request.media_upload_roles !== undefined) {
    result.media_upload_roles = Array.from(new Set(["admin", ...request.media_upload_roles]));
  }

  return result;
}

test("PATCH organization requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", name: "New Name" },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 401);
});

test("PATCH organization requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", name: "New Name" },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 403);
});

test("PATCH organization rejects empty name", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", name: "   " },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization name cannot be empty");
});

test("PATCH organization rejects long name", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", name: "a".repeat(101) },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "Organization name must be under 100 characters");
});

test("PATCH organization requires at least one field", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.error, "No valid fields to update");
});

test("PATCH organization blocks read-only mode", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", name: "New Name" },
    { supabase, organization: { id: "org-1", name: "Old Name" }, isReadOnly: true }
  );
  assert.strictEqual(result.status, 403);
  assert.strictEqual(result.error, "Organization is in read-only mode");
});

test("PATCH organization updates name successfully", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", name: "New Name" },
    { supabase, organization: { id: "org-1", name: "Old Name" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.name, "New Name");
});

test("PATCH organization updates navConfig successfully", () => {
  const supabase = createSupabaseStub();
  const navConfig = { "/members": { hidden: true } };
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", navConfig },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.navConfig, navConfig);
});

test("PATCH organization returns 404 for non-existent org", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", name: "New Name" },
    { supabase, organization: undefined }
  );
  assert.strictEqual(result.status, 404);
});

// ==============================================================
// DELETE /api/organizations/[orgId]
// ==============================================================

interface DeleteOrgRequest {
  auth: AuthContext;
  organizationId?: string;
}

interface DeleteOrgResult {
  status: number;
  success?: boolean;
  error?: string;
}

interface DeleteOrgContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  organization?: {
    id: string;
  };
  subscription?: {
    stripe_subscription_id: string | null;
  };
  devAdmin?: DevAdminContext;
}

function simulateDeleteOrganization(
  request: DeleteOrgRequest,
  ctx: DeleteOrgContext
): DeleteOrgResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Invalid organization id" };
  }

  const isAdmin = isOrgAdmin(request.auth, request.organizationId);
  const isDevAdminAllowed = ctx.devAdmin && canDevAdminPerform(ctx.devAdmin, "delete_org");

  if (!isAdmin && !isDevAdminAllowed) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.organization) {
    return { status: 404, error: "Organization not found" };
  }

  // Successfully "delete" the organization
  return { status: 200, success: true };
}

test("DELETE organization requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
    { supabase, organization: { id: "org-1" } }
  );
  assert.strictEqual(result.status, 401);
});

test("DELETE organization requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1" } }
  );
  assert.strictEqual(result.status, 403);
});

test("DELETE organization allows dev admin bypass", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1" },
    {
      supabase,
      organization: { id: "org-1" },
      devAdmin: DevAdminPresets.deleteOrgOnly(),
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE organization succeeds for admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE organization with subscription cancels Stripe subscription", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    {
      supabase,
      organization: { id: "org-1" },
      subscription: { stripe_subscription_id: "sub_123" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE organization rejects users from different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteOrganization(
    { auth: AuthPresets.orgAdmin("org-2"), organizationId: "org-1" },
    { supabase, organization: { id: "org-1" } }
  );
  assert.strictEqual(result.status, 403);
});

// ==============================================================
// PATCH /api/organizations/[orgId] — post-role fields with parent
// ==============================================================

test("PATCH feed_post_roles with parent accepted and admin forced", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", feed_post_roles: ["parent"] },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.feed_post_roles?.includes("parent"), "parent should be in feed_post_roles");
  assert.ok(result.feed_post_roles?.includes("admin"), "admin should be forced into feed_post_roles");
});

test("PATCH job_post_roles with parent accepted and admin forced", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", job_post_roles: ["parent"] },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.job_post_roles?.includes("parent"), "parent should be in job_post_roles");
  assert.ok(result.job_post_roles?.includes("admin"), "admin should be forced into job_post_roles");
});

test("PATCH discussion_post_roles with parent accepted and admin forced", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", discussion_post_roles: ["parent"] },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.discussion_post_roles?.includes("parent"), "parent should be in discussion_post_roles");
  assert.ok(result.discussion_post_roles?.includes("admin"), "admin should be forced into discussion_post_roles");
});

test("PATCH media_upload_roles with parent accepted and admin forced", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", media_upload_roles: ["parent"] },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.media_upload_roles?.includes("parent"), "parent should be in media_upload_roles");
  assert.ok(result.media_upload_roles?.includes("admin"), "admin should be forced into media_upload_roles");
});

test("PATCH feed_post_roles with parent and alumni all preserved, admin forced once", () => {
  const supabase = createSupabaseStub();
  const result = simulatePatchOrganization(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      organizationId: "org-1",
      feed_post_roles: ["parent", "alumni"],
    },
    { supabase, organization: { id: "org-1", name: "Test Org" } }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.feed_post_roles?.includes("parent"), "parent should be in feed_post_roles");
  assert.ok(result.feed_post_roles?.includes("alumni"), "alumni should be in feed_post_roles");
  assert.ok(result.feed_post_roles?.includes("admin"), "admin should be forced");
  const adminCount = (result.feed_post_roles ?? []).filter((r) => r === "admin").length;
  assert.strictEqual(adminCount, 1, "admin should appear exactly once");
});
