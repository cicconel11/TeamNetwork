import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  AuthPresets,
  createAuthContext,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import type { AdoptionRequestStatus, EnterpriseRole } from "../../../src/types/enterprise.ts";

/**
 * Tests for enterprise adoption acceptance routes:
 * - GET /api/enterprise/[enterpriseId]/adoption-requests/[requestId]
 * - DELETE /api/enterprise/[enterpriseId]/adoption-requests/[requestId] (withdraw)
 * - POST /api/organizations/[orgId]/adoption-requests/[requestId]/accept
 * - POST /api/organizations/[orgId]/adoption-requests/[requestId]/reject
 *
 * These tests verify:
 * 1. Authentication requirements
 * 2. Authorization (enterprise role requirements)
 * 3. Adoption flow logic
 */

// Types
interface MockEnterpriseRole {
  enterprise_id: string;
  role: EnterpriseRole;
}

interface EnterpriseAuthContext extends AuthContext {
  enterpriseRoles: MockEnterpriseRole[];
}

interface MockAdoptionRequest {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  status: AdoptionRequestStatus;
  expires_at: string | null;
}

interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  enterprise_id: string | null;
}

interface AdoptionRequestContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  request?: MockAdoptionRequest | null;
  organization?: MockOrganization | null;
  quotaAllowed?: boolean;
  quotaError?: string;
}

// Auth helpers for enterprise roles
function createEnterpriseAuthContext(options: {
  user?: AuthContext["user"];
  memberships?: AuthContext["memberships"];
  enterpriseRoles?: MockEnterpriseRole[];
}): EnterpriseAuthContext {
  const base = createAuthContext({
    user: options.user,
    memberships: options.memberships,
  });
  return {
    ...base,
    enterpriseRoles: options.enterpriseRoles ?? [],
  };
}

function hasEnterpriseRole(
  ctx: EnterpriseAuthContext,
  enterpriseId: string
): boolean {
  return ctx.enterpriseRoles.some((r) => r.enterprise_id === enterpriseId);
}

function isEnterpriseOwner(
  ctx: EnterpriseAuthContext,
  enterpriseId: string
): boolean {
  return ctx.enterpriseRoles.some(
    (r) => r.enterprise_id === enterpriseId && r.role === "owner"
  );
}

function isOrgAdmin(ctx: AuthContext, orgId: string): boolean {
  return ctx.memberships.some(
    (m) =>
      m.organization_id === orgId && m.role === "admin" && m.status === "active"
  );
}

// Enterprise auth presets
const EnterpriseAuthPresets = {
  unauthenticated: createEnterpriseAuthContext({}),

  authenticatedNoEnterprise: createEnterpriseAuthContext({
    user: { id: "user-123", email: "user@example.com" },
    memberships: [],
    enterpriseRoles: [],
  }),

  enterpriseOwner: (enterpriseId: string = "enterprise-1") =>
    createEnterpriseAuthContext({
      user: { id: "owner-user", email: "owner@example.com" },
      memberships: [],
      enterpriseRoles: [{ enterprise_id: enterpriseId, role: "owner" }],
    }),

  enterpriseBillingAdmin: (enterpriseId: string = "enterprise-1") =>
    createEnterpriseAuthContext({
      user: { id: "billing-user", email: "billing@example.com" },
      memberships: [],
      enterpriseRoles: [{ enterprise_id: enterpriseId, role: "billing_admin" }],
    }),

  enterpriseOrgAdmin: (enterpriseId: string = "enterprise-1") =>
    createEnterpriseAuthContext({
      user: { id: "org-admin-user", email: "orgadmin@example.com" },
      memberships: [],
      enterpriseRoles: [{ enterprise_id: enterpriseId, role: "org_admin" }],
    }),
};

// ==============================================================
// GET adoption request
// ==============================================================

interface GetAdoptionRequestRequest {
  auth: EnterpriseAuthContext;
  enterpriseId: string;
  requestId: string;
}

interface GetAdoptionRequestResult {
  status: number;
  request?: MockAdoptionRequest;
  error?: string;
}

function simulateGetAdoptionRequest(
  request: GetAdoptionRequestRequest,
  ctx: AdoptionRequestContext
): GetAdoptionRequestResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Any enterprise role can view
  if (!hasEnterpriseRole(request.auth, request.enterpriseId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.request || ctx.request.id !== request.requestId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.enterprise_id !== request.enterpriseId) {
    return { status: 404, error: "Request not found" };
  }

  return { status: 200, request: ctx.request };
}

test("GET adoption request requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.unauthenticated,
      enterpriseId: "enterprise-1",
      requestId: "request-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
});

test("GET adoption request requires enterprise membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.authenticatedNoEnterprise,
      enterpriseId: "enterprise-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 403);
});

test("GET adoption request allows any enterprise role to view", () => {
  const supabase = createSupabaseStub();
  const roles = [
    EnterpriseAuthPresets.enterpriseOwner("enterprise-1"),
    EnterpriseAuthPresets.enterpriseBillingAdmin("enterprise-1"),
    EnterpriseAuthPresets.enterpriseOrgAdmin("enterprise-1"),
  ];

  for (const auth of roles) {
    const result = simulateGetAdoptionRequest(
      {
        auth,
        enterpriseId: "enterprise-1",
        requestId: "request-1",
      },
      {
        supabase,
        request: {
          id: "request-1",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          status: "pending",
          expires_at: null,
        },
      }
    );

    assert.strictEqual(result.status, 200, `Role should be able to view request`);
  }
});

test("GET adoption request returns 404 for non-existent request", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.enterpriseOwner("enterprise-1"),
      enterpriseId: "enterprise-1",
      requestId: "non-existent",
    },
    { supabase, request: null }
  );

  assert.strictEqual(result.status, 404);
});

test("GET adoption request returns 404 for request from different enterprise", () => {
  const supabase = createSupabaseStub();
  const result = simulateGetAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.enterpriseOwner("enterprise-1"),
      enterpriseId: "enterprise-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "other-enterprise",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 404);
});

// ==============================================================
// DELETE adoption request (withdraw)
// ==============================================================

interface WithdrawAdoptionRequestRequest {
  auth: EnterpriseAuthContext;
  enterpriseId: string;
  requestId: string;
}

interface WithdrawAdoptionRequestResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateWithdrawAdoptionRequest(
  request: WithdrawAdoptionRequestRequest,
  ctx: AdoptionRequestContext
): WithdrawAdoptionRequestResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Only owner can withdraw
  if (!isEnterpriseOwner(request.auth, request.enterpriseId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.request || ctx.request.id !== request.requestId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.enterprise_id !== request.enterpriseId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.status !== "pending") {
    return { status: 400, error: "Only pending requests can be withdrawn" };
  }

  return { status: 200, success: true };
}

test("DELETE adoption request requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateWithdrawAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.unauthenticated,
      enterpriseId: "enterprise-1",
      requestId: "request-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
});

test("DELETE adoption request requires owner role", () => {
  const supabase = createSupabaseStub();
  const nonOwnerRoles = [
    EnterpriseAuthPresets.enterpriseBillingAdmin("enterprise-1"),
    EnterpriseAuthPresets.enterpriseOrgAdmin("enterprise-1"),
  ];

  for (const auth of nonOwnerRoles) {
    const result = simulateWithdrawAdoptionRequest(
      {
        auth,
        enterpriseId: "enterprise-1",
        requestId: "request-1",
      },
      {
        supabase,
        request: {
          id: "request-1",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          status: "pending",
          expires_at: null,
        },
      }
    );

    assert.strictEqual(result.status, 403);
  }
});

test("DELETE adoption request succeeds for owner", () => {
  const supabase = createSupabaseStub();
  const result = simulateWithdrawAdoptionRequest(
    {
      auth: EnterpriseAuthPresets.enterpriseOwner("enterprise-1"),
      enterpriseId: "enterprise-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE adoption request fails for non-pending request", () => {
  const supabase = createSupabaseStub();
  const nonPendingStatuses: AdoptionRequestStatus[] = [
    "accepted",
    "rejected",
    "expired",
  ];

  for (const status of nonPendingStatuses) {
    const result = simulateWithdrawAdoptionRequest(
      {
        auth: EnterpriseAuthPresets.enterpriseOwner("enterprise-1"),
        enterpriseId: "enterprise-1",
        requestId: "request-1",
      },
      {
        supabase,
        request: {
          id: "request-1",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          status,
          expires_at: null,
        },
      }
    );

    assert.strictEqual(result.status, 400, `Status "${status}" should not be withdrawable`);
    assert.ok(result.error?.includes("pending"));
  }
});

// ==============================================================
// Accept adoption request (org admin action)
// ==============================================================

interface AcceptAdoptionRequest {
  auth: AuthContext;
  orgId: string;
  requestId: string;
}

interface AcceptAdoptionResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateAcceptAdoption(
  request: AcceptAdoptionRequest,
  ctx: AdoptionRequestContext
): AcceptAdoptionResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Must be org admin
  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.request || ctx.request.id !== request.requestId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.organization_id !== request.orgId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.status !== "pending") {
    return { status: 400, error: "Request has already been processed" };
  }

  // Check expiration
  if (
    ctx.request.expires_at &&
    new Date(ctx.request.expires_at) < new Date()
  ) {
    return { status: 400, error: "Request has expired" };
  }

  // Check org not already adopted
  if (ctx.organization?.enterprise_id) {
    return { status: 400, error: "Organization already belongs to an enterprise" };
  }

  // Check quota — distinguish infra errors (503) from client errors (400)
  if (ctx.quotaAllowed === false) {
    const errorMsg = ctx.quotaError || "Quota exceeded";
    const isInfraError = errorMsg.includes("Unable to verify") || errorMsg.includes("Failed to verify");
    return { status: isInfraError ? 503 : 400, error: errorMsg };
  }

  return { status: 200, success: true };
}

test("Accept adoption requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.unauthenticated,
      orgId: "org-1",
      requestId: "request-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
});

test("Accept adoption requires org admin role", () => {
  const supabase = createSupabaseStub();
  const nonAdminRoles = [
    AuthPresets.orgMember("org-1"),
    AuthPresets.orgAlumni("org-1"),
  ];

  for (const auth of nonAdminRoles) {
    const result = simulateAcceptAdoption(
      {
        auth,
        orgId: "org-1",
        requestId: "request-1",
      },
      {
        supabase,
        request: {
          id: "request-1",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          status: "pending",
          expires_at: null,
        },
        organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
        quotaAllowed: true,
      }
    );

    assert.strictEqual(result.status, 403);
  }
});

test("Accept adoption succeeds for org admin", () => {
  const supabase = createSupabaseStub();
  const futureDate = new Date(Date.now() + 86400000 * 7).toISOString();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: futureDate,
      },
      organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
      quotaAllowed: true,
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("Accept adoption fails for expired request", () => {
  const supabase = createSupabaseStub();
  const expiredDate = new Date(Date.now() - 86400000).toISOString();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: expiredDate,
      },
      organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
      quotaAllowed: true,
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("expired"));
});

test("Accept adoption fails when org already belongs to enterprise", () => {
  const supabase = createSupabaseStub();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
      organization: {
        id: "org-1",
        name: "Test Org",
        slug: "test-org",
        enterprise_id: "other-enterprise",
      },
      quotaAllowed: true,
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("already belongs to an enterprise"));
});

test("Accept adoption fails when quota would be exceeded", () => {
  const supabase = createSupabaseStub();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
      quotaAllowed: false,
      quotaError: "Adoption would exceed alumni limit (6000/5000)",
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("exceed alumni limit"));
});

test("Accept adoption returns 503 on seat-limit infra failure", () => {
  const supabase = createSupabaseStub();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
      quotaAllowed: false,
      quotaError: "Unable to verify seat limit. Please try again.",
    }
  );

  assert.strictEqual(result.status, 503);
  assert.ok(result.error?.includes("Unable to verify"));
});

test("Accept adoption returns 503 on alumni-count infra failure", () => {
  const supabase = createSupabaseStub();

  const result = simulateAcceptAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
      quotaAllowed: false,
      quotaError: "Failed to verify alumni count",
    }
  );

  assert.strictEqual(result.status, 503);
  assert.ok(result.error?.includes("Failed to verify"));
});

test("Accept adoption fails for already processed request", () => {
  const supabase = createSupabaseStub();
  const processedStatuses: AdoptionRequestStatus[] = [
    "accepted",
    "rejected",
    "expired",
  ];

  for (const status of processedStatuses) {
    const result = simulateAcceptAdoption(
      {
        auth: AuthPresets.orgAdmin("org-1"),
        orgId: "org-1",
        requestId: "request-1",
      },
      {
        supabase,
        request: {
          id: "request-1",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          status,
          expires_at: null,
        },
        organization: { id: "org-1", name: "Test Org", slug: "test-org", enterprise_id: null },
        quotaAllowed: true,
      }
    );

    assert.strictEqual(result.status, 400, `Status "${status}" should not be acceptable`);
    assert.ok(result.error?.includes("already been processed"));
  }
});

// ==============================================================
// Reject adoption request (org admin action)
// ==============================================================

interface RejectAdoptionRequest {
  auth: AuthContext;
  orgId: string;
  requestId: string;
}

interface RejectAdoptionResult {
  status: number;
  success?: boolean;
  error?: string;
}

function simulateRejectAdoption(
  request: RejectAdoptionRequest,
  ctx: AdoptionRequestContext
): RejectAdoptionResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Must be org admin
  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden" };
  }

  if (!ctx.request || ctx.request.id !== request.requestId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.organization_id !== request.orgId) {
    return { status: 404, error: "Request not found" };
  }

  if (ctx.request.status !== "pending") {
    return { status: 400, error: "Request has already been processed" };
  }

  return { status: 200, success: true };
}

test("Reject adoption requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.unauthenticated,
      orgId: "org-1",
      requestId: "request-1",
    },
    { supabase }
  );

  assert.strictEqual(result.status, 401);
});

test("Reject adoption requires org admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.orgMember("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 403);
});

test("Reject adoption succeeds for org admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("Reject adoption fails for already processed request", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        status: "accepted",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("already been processed"));
});

test("Reject adoption returns 404 for non-existent request", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "non-existent",
    },
    { supabase, request: null }
  );

  assert.strictEqual(result.status, 404);
});

test("Reject adoption returns 404 for request belonging to different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateRejectAdoption(
    {
      auth: AuthPresets.orgAdmin("org-1"),
      orgId: "org-1",
      requestId: "request-1",
    },
    {
      supabase,
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "other-org",
        requested_by: "user-1",
        status: "pending",
        expires_at: null,
      },
    }
  );

  assert.strictEqual(result.status, 404);
});
