import { describe, it } from "node:test";
import assert from "node:assert";
import type { CreateAdoptionRequestResult } from "../../src/lib/enterprise/adoption.ts";
import type { AdoptionRequestStatus } from "../../src/types/enterprise.ts";

/**
 * Tests for enterprise adoption utilities
 *
 * These tests verify:
 * 1. createAdoptionRequest() with valid/invalid inputs
 * 2. acceptAdoptionRequest() flow
 * 3. rejectAdoptionRequest() flow
 * 4. Expiration handling
 *
 * Since the actual functions use Supabase, we test the logic
 * by simulating the function behavior with mocked data.
 */

const ADOPTION_EXPIRY_DAYS = 7;

interface MockOrganization {
  id: string;
  name: string;
  enterprise_id: string | null;
}

interface MockAdoptionRequest {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string;
  requested_at: string;
  status: AdoptionRequestStatus;
  responded_by: string | null;
  responded_at: string | null;
  expires_at: string | null;
}

interface MockQuotaCheck {
  allowed: boolean;
  error?: string;
  wouldBeTotal?: number;
  limit?: number;
}

interface MockSeatQuotaCheck {
  allowed: boolean;
  currentCount: number;
  maxAllowed: number | null;
  needsUpgrade: boolean;
}

interface CreateAdoptionContext {
  organizations: MockOrganization[];
  existingRequests: MockAdoptionRequest[];
  quotaCheck: MockQuotaCheck;
}

// Simulates createAdoptionRequest logic
function simulateCreateAdoptionRequest(
  enterpriseId: string,
  organizationId: string,
  requestedBy: string,
  ctx: CreateAdoptionContext
): CreateAdoptionRequestResult {
  // Check org exists
  const org = ctx.organizations.find((o) => o.id === organizationId);
  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  // Check org is standalone
  if (org.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  // Check quota
  if (!ctx.quotaCheck.allowed) {
    return { success: false, error: ctx.quotaCheck.error };
  }

  // Check for existing pending request
  const existingPending = ctx.existingRequests.find(
    (r) =>
      r.enterprise_id === enterpriseId &&
      r.organization_id === organizationId &&
      r.status === "pending"
  );

  if (existingPending) {
    return {
      success: false,
      error: "A pending adoption request already exists for this organization",
    };
  }

  // Create request
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ADOPTION_EXPIRY_DAYS);

  return {
    success: true,
    requestId: `request-${Date.now()}`,
  };
}

interface AcceptAdoptionContext {
  request: MockAdoptionRequest | null;
  organization: MockOrganization | null;
  quotaCheck: MockQuotaCheck;
  seatQuotaCheck?: MockSeatQuotaCheck;
}

interface AcceptAdoptionResult {
  success: boolean;
  error?: string;
}

// Simulates acceptAdoptionRequest logic
function simulateAcceptAdoptionRequest(
  requestId: string,
  respondedBy: string,
  ctx: AcceptAdoptionContext
): AcceptAdoptionResult {
  if (!ctx.request) {
    return { success: false, error: "Request not found" };
  }

  if (ctx.request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  // Check expiration
  if (ctx.request.expires_at && new Date(ctx.request.expires_at) < new Date()) {
    return { success: false, error: "Request has expired" };
  }

  // Re-verify org is standalone
  if (ctx.organization?.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  // Check alumni quota again
  if (!ctx.quotaCheck.allowed) {
    return { success: false, error: ctx.quotaCheck.error };
  }

  // Check seat limit for enterprise-managed orgs
  if (ctx.seatQuotaCheck && !ctx.seatQuotaCheck.allowed) {
    return {
      success: false,
      error: `Seat limit reached. You have used all ${ctx.seatQuotaCheck.maxAllowed} enterprise-managed org seats. Add more seats to adopt additional organizations.`,
    };
  }

  return { success: true };
}

interface RejectAdoptionContext {
  request: MockAdoptionRequest | null;
}

interface RejectAdoptionResult {
  success: boolean;
  error?: string;
}

// Simulates rejectAdoptionRequest logic
function simulateRejectAdoptionRequest(
  requestId: string,
  respondedBy: string,
  ctx: RejectAdoptionContext
): RejectAdoptionResult {
  if (!ctx.request) {
    return { success: false, error: "Request not found" };
  }

  if (ctx.request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  return { success: true };
}

describe("createAdoptionRequest", () => {
  it("returns error when organization not found", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [],
      existingRequests: [],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-not-found",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization not found");
  });

  it("returns error when organization already belongs to enterprise", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [
        { id: "org-1", name: "Test Org", enterprise_id: "other-enterprise" },
      ],
      existingRequests: [],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization already belongs to an enterprise");
  });

  it("returns error when quota check fails", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [{ id: "org-1", name: "Test Org", enterprise_id: null }],
      existingRequests: [],
      quotaCheck: {
        allowed: false,
        error: "Adoption would exceed alumni limit (6000/5000)",
      },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
  });

  it("returns error when pending request already exists", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [{ id: "org-1", name: "Test Org", enterprise_id: null }],
      existingRequests: [
        {
          id: "existing-request",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          requested_at: new Date().toISOString(),
          status: "pending",
          responded_by: null,
          responded_at: null,
          expires_at: null,
        },
      ],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("pending adoption request already exists"));
  });

  it("succeeds with valid inputs", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [{ id: "org-1", name: "Test Org", enterprise_id: null }],
      existingRequests: [],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, true);
    assert.ok(result.requestId);
  });

  it("allows request when previous request was rejected", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [{ id: "org-1", name: "Test Org", enterprise_id: null }],
      existingRequests: [
        {
          id: "old-request",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          requested_at: new Date().toISOString(),
          status: "rejected",
          responded_by: "responder-1",
          responded_at: new Date().toISOString(),
          expires_at: null,
        },
      ],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, true);
  });

  it("allows request when previous request was expired", () => {
    const ctx: CreateAdoptionContext = {
      organizations: [{ id: "org-1", name: "Test Org", enterprise_id: null }],
      existingRequests: [
        {
          id: "old-request",
          enterprise_id: "enterprise-1",
          organization_id: "org-1",
          requested_by: "user-1",
          requested_at: new Date().toISOString(),
          status: "expired",
          responded_by: null,
          responded_at: null,
          expires_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      quotaCheck: { allowed: true },
    };

    const result = simulateCreateAdoptionRequest(
      "enterprise-1",
      "org-1",
      "user-1",
      ctx
    );

    assert.strictEqual(result.success, true);
  });
});

describe("acceptAdoptionRequest", () => {
  it("returns error when request not found", () => {
    const ctx: AcceptAdoptionContext = {
      request: null,
      organization: null,
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request not found");
  });

  it("returns error when request already processed", () => {
    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "accepted",
        responded_by: "responder-1",
        responded_at: new Date().toISOString(),
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-2", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request is rejected status", () => {
    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "rejected",
        responded_by: "responder-1",
        responded_at: new Date().toISOString(),
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-2", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request has expired", () => {
    const expiredDate = new Date(Date.now() - 86400000); // 1 day ago

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: expiredDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has expired");
  });

  it("returns error when org already joined another enterprise", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7); // 7 days from now

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: {
        id: "org-1",
        name: "Test Org",
        enterprise_id: "other-enterprise",
      },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization already belongs to an enterprise");
  });

  it("returns error when quota check fails at acceptance time", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7);

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: {
        allowed: false,
        error: "Adoption would exceed alumni limit",
      },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
  });

  it("succeeds with valid pending request", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7);

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });

  it("succeeds with request that has no expiration", () => {
    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: null,
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });

  it("returns error when seat limit is reached", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7);

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuotaCheck: {
        allowed: false,
        currentCount: 5,
        maxAllowed: 5,
        needsUpgrade: true,
      },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("Seat limit reached"));
    assert.ok(result.error?.includes("5 enterprise-managed org seats"));
  });

  it("succeeds when seat limit has room", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7);

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuotaCheck: {
        allowed: true,
        currentCount: 3,
        maxAllowed: 5,
        needsUpgrade: false,
      },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });

  it("succeeds when enterprise has no seat limit (legacy tier-based)", () => {
    const futureDate = new Date(Date.now() + 86400000 * 7);

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: futureDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuotaCheck: {
        allowed: true,
        currentCount: 0,
        maxAllowed: null,
        needsUpgrade: false,
      },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });
});

describe("rejectAdoptionRequest", () => {
  it("returns error when request not found", () => {
    const ctx: RejectAdoptionContext = {
      request: null,
    };

    const result = simulateRejectAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request not found");
  });

  it("returns error when request already processed (accepted)", () => {
    const ctx: RejectAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "accepted",
        responded_by: "responder-1",
        responded_at: new Date().toISOString(),
        expires_at: null,
      },
    };

    const result = simulateRejectAdoptionRequest("request-1", "responder-2", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request already rejected", () => {
    const ctx: RejectAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "rejected",
        responded_by: "responder-1",
        responded_at: new Date().toISOString(),
        expires_at: null,
      },
    };

    const result = simulateRejectAdoptionRequest("request-1", "responder-2", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request is expired status", () => {
    const ctx: RejectAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "expired",
        responded_by: null,
        responded_at: null,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
      },
    };

    const result = simulateRejectAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("succeeds with valid pending request", () => {
    const ctx: RejectAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: null,
      },
    };

    const result = simulateRejectAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });
});

describe("adoption expiration", () => {
  it("request expires after ADOPTION_EXPIRY_DAYS", () => {
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + ADOPTION_EXPIRY_DAYS);

    const daysDiff = Math.round(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    assert.strictEqual(daysDiff, ADOPTION_EXPIRY_DAYS);
  });

  it("expired request cannot be accepted even if status is still pending", () => {
    const expiredDate = new Date(Date.now() - 1000); // 1 second ago

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date(Date.now() - 86400000 * 8).toISOString(),
        status: "pending", // Still pending, but expired
        responded_by: null,
        responded_at: null,
        expires_at: expiredDate.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has expired");
  });

  it("request just about to expire can still be accepted", () => {
    const almostExpired = new Date(Date.now() + 1000); // 1 second from now

    const ctx: AcceptAdoptionContext = {
      request: {
        id: "request-1",
        enterprise_id: "enterprise-1",
        organization_id: "org-1",
        requested_by: "user-1",
        requested_at: new Date().toISOString(),
        status: "pending",
        responded_by: null,
        responded_at: null,
        expires_at: almostExpired.toISOString(),
      },
      organization: { id: "org-1", name: "Test Org", enterprise_id: null },
      quotaCheck: { allowed: true },
    };

    const result = simulateAcceptAdoptionRequest("request-1", "responder-1", ctx);

    assert.strictEqual(result.success, true);
  });
});
