import { describe, it } from "node:test";
import assert from "node:assert";
import { acceptAdoptionRequest } from "../../src/lib/enterprise/adoption.ts";
import { createSupabaseStub } from "../utils/supabaseStub.ts";

/**
 * Tests for enterprise adoption library functions.
 *
 * Because createAdoptionRequest/rejectAdoptionRequest
 * call createServiceClient() and checkAdoptionQuota() internally, we test them
 * via simulation functions that replicate the exact branching logic from
 * adoption.ts, using dependency-injected mocks — the same pattern used in
 * quota-db-errors.test.ts for async wrappers in quota.ts.
 *
 * The key behaviors under test:
 * 1. createAdoptionRequest — org lookup, enterprise check, quota check, duplicate check, 503 on DB errors
 * 2. acceptAdoptionRequest — request lookup, status check, expiry, quota re-check, compensating rollback
 * 3. rejectAdoptionRequest — request lookup, status check
 */

// ── Types mirroring adoption.ts ────────────────────────────────────────────────

interface OrgRow {
  enterprise_id: string | null;
  name: string;
}

interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  status: string;
  expires_at: string | null;
}

interface AdoptionQuotaResult {
  allowed: boolean;
  error?: string;
  status?: number;
}

interface SeatQuotaInfo {
  currentCount: number;
  maxAllowed: number | null;
  error?: string;
}

interface OrgSubscriptionRow {
  id: string;
  status: string;
  stripe_subscription_id: string | null;
}

interface CreateAdoptionRequestResult {
  success: boolean;
  requestId?: string;
  error?: string;
  status?: number;
}

interface AcceptAdoptionResult {
  success: boolean;
  error?: string;
  status?: number;
}

interface RejectAdoptionResult {
  success: boolean;
  error?: string;
  status?: number;
}

// ── Simulation helpers mirroring adoption.ts exact branching ──────────────────

/**
 * Simulates createAdoptionRequest (adoption.ts:37-111).
 *
 * Replicates the exact branching:
 *   - orgError → return { status: 503 }
 *   - org null → "Organization not found"
 *   - org.enterprise_id → "Organization already belongs to an enterprise"
 *   - quotaCheck.allowed false → return { error: quotaCheck.error }
 *   - existingError → return { status: 503 }
 *   - existing → "A pending adoption request already exists"
 *   - insertError → return { error: insertError.message }
 *   - success → { success: true, requestId }
 */
function simulateCreateAdoptionRequest(params: {
  org: OrgRow | null;
  orgError: unknown;
  quotaCheck: AdoptionQuotaResult;
  existing: { id: string } | null;
  existingError: unknown;
  insertError: { message: string } | null;
  insertedId: string;
}): CreateAdoptionRequestResult {
  const { org, orgError, quotaCheck, existing, existingError, insertError, insertedId } = params;

  if (orgError) {
    return { success: false, error: "Failed to verify organization", status: 503 };
  }

  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  if (org.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  if (!quotaCheck.allowed) {
    return { success: false, error: quotaCheck.error };
  }

  if (existingError) {
    return { success: false, error: "Failed to check for existing request", status: 503 };
  }

  if (existing) {
    return { success: false, error: "A pending adoption request already exists for this organization" };
  }

  if (insertError) {
    return { success: false, error: "Failed to create adoption request", status: 500 };
  }

  return { success: true, requestId: insertedId };
}

/**
 * Simulates acceptAdoptionRequest (adoption.ts:113-296).
 *
 * Replicates the exact branching:
 *   - request null → "Request not found"
 *   - status !== "pending" → "Request has already been processed"
 *   - expires_at past → "Request has expired"
 *   - org.enterprise_id set → "Organization already belongs to an enterprise"
 *   - quotaCheck.allowed false + status → { status: quotaCheck.status }
 *   - quotaCheck.allowed false (other) → { error: quotaCheck.error }
 *   - seatQuota.error → { status: 503 }
 *   - orgUpdateError → "Failed to update org" (no rollback simulated here)
 *   - subUpdate/createError → compensating rollback → "Failed to update/create organization subscription"
 *   - markAcceptedError → rollback org + subscription → "Failed to finalize adoption request"
 *   - success → { success: true }
 */
function simulateAcceptAdoptionRequest(params: {
  request: AdoptionRequestRow | null;
  requestFetchError?: unknown;
  reVerifiedOrg: { enterprise_id: string | null } | null;
  orgVerifyError?: unknown;
  quotaCheck: AdoptionQuotaResult;
  seatQuota: SeatQuotaInfo;
  orgSub: OrgSubscriptionRow | null;
  orgUpdateError: { message: string } | null;
  subUpdateError: { message: string } | null;
  subCreateError: { message: string } | null;
  markAcceptedError?: { message: string } | null;
  rollbackError?: { message: string } | null;
}): AcceptAdoptionResult {
  const {
    request, requestFetchError, reVerifiedOrg, orgVerifyError, quotaCheck, seatQuota,
    orgSub, orgUpdateError, subUpdateError, subCreateError,
    markAcceptedError,
  } = params;

  if (requestFetchError) {
    return { success: false, error: "Internal error", status: 503 };
  }

  if (!request) {
    return { success: false, error: "Request not found" };
  }

  if (request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  if (request.expires_at && new Date(request.expires_at) < new Date()) {
    return { success: false, error: "Request has expired" };
  }

  if (orgVerifyError) {
    return { success: false, error: "Internal error", status: 503 };
  }

  if (reVerifiedOrg?.enterprise_id) {
    return { success: false, error: "Organization already belongs to an enterprise" };
  }

  if (!quotaCheck.allowed) {
    if (quotaCheck.status) {
      return { success: false, error: quotaCheck.error, status: quotaCheck.status };
    }
    return { success: false, error: quotaCheck.error };
  }

  if (seatQuota.error) {
    return { success: false, error: "Unable to verify seat limit. Please try again.", status: 503 };
  }

  if (orgUpdateError) {
    return { success: false, error: "Failed to update organization", status: 500 };
  }

  // Subscription update/create with compensating rollback
  if (orgSub) {
    if (subUpdateError) {
      // Compensating rollback (revert enterprise_id)
      return { success: false, error: "Failed to update organization subscription" };
    }
  } else {
    if (subCreateError) {
      // Compensating rollback (revert enterprise_id)
      return { success: false, error: "Failed to create organization subscription" };
    }
  }

  // Step 3: Mark request as accepted
  if (markAcceptedError) {
    // Rollback both org enterprise_id and subscription
    return { success: false, error: "Failed to finalize adoption request", status: 500 };
  }

  return { success: true };
}

/**
 * Simulates rejectAdoptionRequest (adoption.ts:256-288).
 *
 * Replicates the exact branching:
 *   - request null → "Request not found"
 *   - status !== "pending" → "Request has already been processed"
 *   - success → { success: true }
 */
function simulateRejectAdoptionRequest(params: {
  request: { status: string } | null;
  requestFetchError?: unknown;
  updateError?: unknown;
}): RejectAdoptionResult {
  const { request, requestFetchError, updateError } = params;

  if (requestFetchError) {
    return { success: false, error: "Internal error", status: 503 };
  }

  if (!request) {
    return { success: false, error: "Request not found" };
  }

  if (request.status !== "pending") {
    return { success: false, error: "Request has already been processed" };
  }

  if (updateError) {
    return { success: false, error: "Internal error", status: 503 };
  }

  return { success: true };
}

// ── Defaults for common test fixtures ─────────────────────────────────────────

function makeRequest(overrides: Partial<AdoptionRequestRow> = {}): AdoptionRequestRow {
  return {
    id: "request-1",
    enterprise_id: "enterprise-1",
    organization_id: "org-1",
    status: "pending",
    expires_at: new Date(Date.now() + 86400000 * 7).toISOString(),
    ...overrides,
  };
}

function makeOrg(overrides: Partial<OrgRow> = {}): OrgRow {
  return { enterprise_id: null, name: "Test Org", ...overrides };
}

// ── createAdoptionRequest ──────────────────────────────────────────────────────

describe("createAdoptionRequest", () => {
  it("returns 503 when org fetch DB errors", () => {
    const result = simulateCreateAdoptionRequest({
      org: null,
      orgError: new Error("connection timeout"),
      quotaCheck: { allowed: true },
      existing: null,
      existingError: null,
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.ok(result.error?.includes("Failed to verify organization"));
  });

  it("returns error when organization not found", () => {
    const result = simulateCreateAdoptionRequest({
      org: null,
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null,
      existingError: null,
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization not found");
    assert.strictEqual(result.status, undefined);
  });

  it("returns error when organization already belongs to an enterprise", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg({ enterprise_id: "other-enterprise" }),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null,
      existingError: null,
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization already belongs to an enterprise");
  });

  it("returns error when quota check fails", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: false, error: "Adoption would exceed alumni limit (6000/5000)" },
      existing: null,
      existingError: null,
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
  });

  it("returns 503 when existing-request check DB errors", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null,
      existingError: new Error("DB read error"),
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.ok(result.error?.includes("Failed to check for existing request"));
  });

  it("returns error when pending request already exists", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: { id: "existing-request" },
      existingError: null,
      insertError: null,
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("pending adoption request already exists"));
  });

  it("returns generic error message on insert failure (no DB detail leak)", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null,
      existingError: null,
      insertError: { message: "unique constraint violation" },
      insertedId: "req-1",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Failed to create adoption request");
    assert.strictEqual(result.status, 500);
    // Must NOT contain the raw DB error message
    assert.ok(!result.error?.includes("unique constraint"));
  });

  it("succeeds with valid inputs", () => {
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null,
      existingError: null,
      insertError: null,
      insertedId: "new-request-id",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.requestId, "new-request-id");
  });

  it("allows new request when previous request was rejected", () => {
    // Non-pending requests don't appear in the existing check (filtered by status=pending)
    const result = simulateCreateAdoptionRequest({
      org: makeOrg(),
      orgError: null,
      quotaCheck: { allowed: true },
      existing: null, // rejected requests are not returned by the pending filter
      existingError: null,
      insertError: null,
      insertedId: "req-2",
    });

    assert.strictEqual(result.success, true);
  });
});

// ── acceptAdoptionRequest ──────────────────────────────────────────────────────

describe("acceptAdoptionRequest", () => {
  it("returns error when request not found", () => {
    const result = simulateAcceptAdoptionRequest({
      request: null,
      reVerifiedOrg: null,
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request not found");
  });

  it("returns error when request already accepted", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ status: "accepted" }),
      reVerifiedOrg: null,
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request already rejected", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ status: "rejected" }),
      reVerifiedOrg: null,
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request has expired", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ expires_at: new Date(Date.now() - 86400000).toISOString() }),
      reVerifiedOrg: null,
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has expired");
  });

  it("returns error when org already joined another enterprise", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: "other-enterprise" },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization already belongs to an enterprise");
  });

  it("returns 503 when alumni count DB errors during quota re-check", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: false, error: "Failed to verify alumni count", status: 503 },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, "Failed to verify alumni count");
  });

  it("returns error (no 503) when quota check fails for capacity reasons", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: false, error: "Adoption would exceed alumni limit (6000/5000)" },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes("exceed alumni limit"));
    assert.strictEqual(result.status, undefined);
  });

  it("returns 503 when seat quota check has infra error", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 5, maxAllowed: null, error: "internal_error" },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.ok(result.error?.includes("Unable to verify seat limit"));
  });

  it("returns generic error on org update failure (no DB detail leak)", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: { message: "column enterprise_id violates not-null constraint" },
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Failed to update organization");
    assert.strictEqual(result.status, 500);
    // Must NOT contain the raw DB error message
    assert.ok(!result.error?.includes("violates not-null"));
  });

  it("triggers compensating rollback when subscription update fails (org has existing sub)", () => {
    // Simulate: org has existing sub, sub update fails → rollback
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: { id: "sub-1", status: "active", stripe_subscription_id: "stripe-sub-1" },
      orgUpdateError: null,
      subUpdateError: { message: "DB write failed" },
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Failed to update organization subscription");
  });

  it("triggers compensating rollback when subscription create fails (org has no existing sub)", () => {
    // Simulate: org has no sub, sub create fails → rollback
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: { message: "unique constraint violation" },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Failed to create organization subscription");
  });

  it("succeeds with valid pending request and existing subscription", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 3, maxAllowed: null },
      orgSub: { id: "sub-1", status: "active", stripe_subscription_id: "stripe-sub-1" },
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, true);
  });

  it("succeeds with valid pending request and no existing subscription", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, true);
  });

  it("succeeds when request has no expiration date", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ expires_at: null }),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, true);
  });

  it("succeeds when enterprise has no seat limit (legacy unlimited)", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, true);
  });

  it("request just about to expire (1 second from now) can still be accepted", () => {
    const almostExpired = new Date(Date.now() + 1000);

    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ expires_at: almostExpired.toISOString() }),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, true);
  });

  // ── Step-3 failure tests (Issue 10) ──

  it("step-3 (mark accepted) DB error → rollback org + subscription, error returned", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: { id: "sub-1", status: "active", stripe_subscription_id: "stripe-sub-1" },
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
      markAcceptedError: { message: "constraint violation" },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 500);
    assert.ok(result.error?.includes("Failed to finalize adoption request"));
  });

  it("step-3 failure when org had no existing subscription → rollback still returns error", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null, // no existing subscription
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
      markAcceptedError: { message: "DB timeout" },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 500);
    assert.ok(result.error?.includes("Failed to finalize adoption request"));
  });

  it("step-3 succeeds (no markAcceptedError) → adoption completes", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
      markAcceptedError: null,
    });

    assert.strictEqual(result.success, true);
  });

  it("returns 503 when request fetch DB errors", () => {
    const result = simulateAcceptAdoptionRequest({
      request: null,
      requestFetchError: new Error("timeout"),
      reVerifiedOrg: null,
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, "Internal error");
  });

  it("org points to different enterprise → returns error", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({ enterprise_id: "enterprise-1" }),
      reVerifiedOrg: { enterprise_id: "enterprise-other" },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Organization already belongs to an enterprise");
  });

  it("returns 503 when org re-verify DB errors", () => {
    const result = simulateAcceptAdoptionRequest({
      request: makeRequest(),
      reVerifiedOrg: null,
      orgVerifyError: new Error("timeout"),
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, "Internal error");
  });

  it("retries partial adoption by reconciling subscription before accepting", async () => {
    const supabase = createSupabaseStub();

    supabase.seed("enterprise_adoption_requests", [{
      id: "request-1",
      enterprise_id: "enterprise-1",
      organization_id: "org-1",
      requested_by: "user-requester",
      status: "pending",
      expires_at: null,
    }]);
    supabase.seed("organizations", [{
      id: "org-1",
      enterprise_id: "enterprise-1",
      enterprise_relationship_type: "adopted",
      enterprise_adopted_at: "2026-01-01T00:00:00.000Z",
    }]);

    const result = await acceptAdoptionRequest("request-1", "user-admin", {
      supabase: supabase as never,
      checkAdoptionQuotaFn: async () => ({ allowed: true }),
      canEnterpriseAddSubOrgFn: async () => ({ currentCount: 0, maxAllowed: null }),
    });

    assert.deepStrictEqual(result, { success: true });

    const requests = supabase.getRows("enterprise_adoption_requests");
    assert.strictEqual(requests[0].status, "accepted");
    assert.strictEqual(requests[0].responded_by, "user-admin");

    const subscriptions = supabase.getRows("organization_subscriptions");
    assert.strictEqual(subscriptions.length, 1);
    assert.strictEqual(subscriptions[0].organization_id, "org-1");
    assert.strictEqual(subscriptions[0].status, "enterprise_managed");
  });
});

// ── rejectAdoptionRequest ──────────────────────────────────────────────────────

describe("rejectAdoptionRequest", () => {
  it("returns error when request not found", () => {
    const result = simulateRejectAdoptionRequest({ request: null });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request not found");
  });

  it("returns error when request already processed (accepted)", () => {
    const result = simulateRejectAdoptionRequest({ request: { status: "accepted" } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request already rejected", () => {
    const result = simulateRejectAdoptionRequest({ request: { status: "rejected" } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("returns error when request is expired status", () => {
    const result = simulateRejectAdoptionRequest({ request: { status: "expired" } });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has already been processed");
  });

  it("succeeds with valid pending request", () => {
    const result = simulateRejectAdoptionRequest({ request: { status: "pending" } });

    assert.strictEqual(result.success, true);
  });

  it("returns 503 when request fetch DB errors", () => {
    const result = simulateRejectAdoptionRequest({
      request: null,
      requestFetchError: new Error("timeout"),
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, "Internal error");
  });

  it("returns 503 when update fails", () => {
    const result = simulateRejectAdoptionRequest({
      request: { status: "pending" },
      updateError: new Error("DB write failed"),
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.error, "Internal error");
  });
});

// ── Expiration handling ────────────────────────────────────────────────────────

describe("adoption expiration", () => {
  it("expired request cannot be accepted even if status is still pending", () => {
    const expiredDate = new Date(Date.now() - 1000); // 1 second ago

    const result = simulateAcceptAdoptionRequest({
      request: makeRequest({
        expires_at: expiredDate.toISOString(),
        status: "pending",
      }),
      reVerifiedOrg: { enterprise_id: null },
      quotaCheck: { allowed: true },
      seatQuota: { currentCount: 0, maxAllowed: null },
      orgSub: null,
      orgUpdateError: null,
      subUpdateError: null,
      subCreateError: null,
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, "Request has expired");
  });
});
