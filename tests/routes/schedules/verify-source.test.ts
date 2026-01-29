import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  hasOrgMembership,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for POST /api/schedules/verify-source
 *
 * This route:
 * 1. Requires authentication
 * 2. Requires org membership (any role)
 * 3. Validates URL format
 * 4. Checks existing domain allowlist status
 * 5. Performs verification if domain is unknown
 * 6. Returns verification result with confidence score
 */

// Types
interface VerifySourceRequest {
  auth: AuthContext;
  orgId?: string;
  url?: string;
}

interface VerifySourceResult {
  status: number;
  vendorId?: string;
  confidence?: number;
  allowStatus?: "active" | "blocked" | "pending" | "denied";
  evidenceSummary?: string;
  maskedUrl?: string;
  error?: string;
  message?: string;
}

interface VerifySourceContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  existingDomainStatus?: {
    status: "active" | "blocked" | "pending" | "denied";
    vendorId?: string;
  };
  verificationResult?: {
    vendorId: string;
    confidence: number;
    allowStatus: "active" | "pending" | "denied";
    evidence: string[];
  };
  urlError?: string;
}

function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const tail = url.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}

function simulateVerifySource(
  request: VerifySourceRequest,
  ctx: VerifySourceContext
): VerifySourceResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to verify schedule sources." };
  }

  // Validate parameters
  if (!request.orgId || !request.url) {
    return { status: 400, error: "Missing parameters", message: "orgId and url are required." };
  }

  // Check org membership (any active member can verify)
  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  // Validate URL
  try {
    new URL(request.url);
  } catch {
    return { status: 400, error: "Invalid URL", message: "Invalid URL." };
  }

  // Check for URL validation errors (SSRF protection)
  if (ctx.urlError) {
    return { status: 400, error: "Invalid URL", message: ctx.urlError };
  }

  // Check existing domain status
  if (ctx.existingDomainStatus) {
    const { status, vendorId } = ctx.existingDomainStatus;
    if (status === "active") {
      return {
        status: 200,
        vendorId: vendorId ?? "unknown",
        confidence: 1,
        allowStatus: "active",
        evidenceSummary: "allowlist rule",
        maskedUrl: maskUrl(request.url),
      };
    }
    if (status === "blocked") {
      return {
        status: 200,
        vendorId: vendorId ?? "unknown",
        confidence: 1,
        allowStatus: "blocked",
        evidenceSummary: "blocked",
        maskedUrl: maskUrl(request.url),
      };
    }
    if (status === "pending") {
      return {
        status: 200,
        vendorId: vendorId ?? "unknown",
        confidence: 0.9,
        allowStatus: "pending",
        evidenceSummary: "pending approval",
        maskedUrl: maskUrl(request.url),
      };
    }
  }

  // Perform verification if domain is unknown
  if (ctx.verificationResult) {
    return {
      status: 200,
      vendorId: ctx.verificationResult.vendorId,
      confidence: ctx.verificationResult.confidence,
      allowStatus: ctx.verificationResult.allowStatus,
      evidenceSummary: ctx.verificationResult.evidence.join(", ") || "verification",
      maskedUrl: maskUrl(request.url),
    };
  }

  return {
    status: 200,
    vendorId: "unknown",
    confidence: 0,
    allowStatus: "denied",
    evidenceSummary: "no matching vendor",
    maskedUrl: maskUrl(request.url),
  };
}

// Tests

test("verify-source requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", url: "https://athletics.example.com/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("verify-source requires orgId and url", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("orgId and url"));
});

test("verify-source requires org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.authenticatedNoOrg, orgId: "org-1", url: "https://athletics.example.com/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("verify-source allows any active member role", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgAlumni("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule" },
    {
      supabase,
      existingDomainStatus: { status: "active", vendorId: "vendorA" },
    }
  );
  assert.strictEqual(result.status, 200);
});

test("verify-source returns active for allowlisted domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://sidearmstats.com/schedule.ics" },
    {
      supabase,
      existingDomainStatus: { status: "active", vendorId: "sidearm" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "active");
  assert.strictEqual(result.confidence, 1);
  assert.strictEqual(result.vendorId, "sidearm");
});

test("verify-source returns blocked for blocked domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://malicious.example.com/schedule" },
    {
      supabase,
      existingDomainStatus: { status: "blocked" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "blocked");
  assert.strictEqual(result.evidenceSummary, "blocked");
});

test("verify-source returns pending for pending domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://pending.example.com/schedule" },
    {
      supabase,
      existingDomainStatus: { status: "pending", vendorId: "vendorB" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "pending");
  assert.strictEqual(result.confidence, 0.9);
});

test("verify-source performs verification for unknown domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://new-vendor.example.com/events.ics" },
    {
      supabase,
      verificationResult: {
        vendorId: "ics",
        confidence: 0.99,
        allowStatus: "active",
        evidence: ["ICS content detected", "valid VCALENDAR"],
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "active");
  assert.strictEqual(result.vendorId, "ics");
  assert.strictEqual(result.confidence, 0.99);
  assert.ok(result.evidenceSummary?.includes("ICS content detected"));
});

test("verify-source returns pending for low-confidence detection", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://unknown.example.com/schedule" },
    {
      supabase,
      verificationResult: {
        vendorId: "generic_html",
        confidence: 0.85,
        allowStatus: "pending",
        evidence: ["table structure detected"],
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "pending");
  assert.strictEqual(result.confidence, 0.85);
});

test("verify-source returns denied for unverifiable domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://random.example.com/page" },
    { supabase }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.allowStatus, "denied");
  assert.strictEqual(result.confidence, 0);
});

test("verify-source masks URL in response", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://athletics.example.com/secret/schedule.ics" },
    {
      supabase,
      existingDomainStatus: { status: "active" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.maskedUrl?.includes("athletics.example.com"));
  assert.ok(!result.maskedUrl?.includes("/secret/"));
});

test("verify-source handles SSRF protection errors", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "http://169.254.169.254/latest/meta-data" },
    { supabase, urlError: "Private IPs are not allowed" }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Private IPs"));
});

test("verify-source validates URL format", () => {
  const supabase = createSupabaseStub();
  const result = simulateVerifySource(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "not-a-valid-url" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Invalid URL"));
});
