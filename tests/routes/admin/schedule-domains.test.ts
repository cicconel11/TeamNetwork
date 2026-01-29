import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for admin schedule domains routes:
 * - GET /api/admin/schedule-domains (list pending domains)
 * - POST /api/admin/schedule-domains/[domainId]/approve
 * - POST /api/admin/schedule-domains/[domainId]/block
 */

// Types
interface DomainRequest {
  auth: AuthContext;
  orgId?: string;
  domainId?: string;
}

interface ListDomainsResult {
  status: number;
  domains?: Array<{
    id: string;
    hostname: string;
    status: string;
    vendor_id?: string;
  }>;
  error?: string;
  message?: string;
}

interface DomainActionResult {
  status: number;
  domain?: {
    id: string;
    hostname: string;
    status: string;
  };
  disabledSources?: number;
  error?: string;
  message?: string;
}

interface DomainContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  domain?: {
    id: string;
    hostname: string;
    status: string;
    verified_by_org_id: string;
    vendor_id?: string;
    fingerprint?: Record<string, unknown>;
  };
  pendingDomains?: Array<{
    id: string;
    hostname: string;
    status: string;
    vendor_id?: string;
    verified_by_org_id: string;
  }>;
  matchingSources?: Array<{
    id: string;
    source_url: string;
  }>;
}

// ==============================================================
// GET /api/admin/schedule-domains
// ==============================================================

function simulateListDomains(
  request: DomainRequest,
  ctx: DomainContext
): ListDomainsResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to view schedule approvals." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can review schedule domains." };
  }

  // Filter domains that are pending and belong to this org
  const domains = (ctx.pendingDomains || [])
    .filter((d) => d.status === "pending" && d.verified_by_org_id === request.orgId)
    .map(({ id, hostname, status, vendor_id }) => ({ id, hostname, status, vendor_id }));

  return { status: 200, domains };
}

test("GET schedule-domains requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateListDomains(
    { auth: AuthPresets.unauthenticated, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("GET schedule-domains requires orgId", () => {
  const supabase = createSupabaseStub();
  const result = simulateListDomains(
    { auth: AuthPresets.orgAdmin("org-1") },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("orgId"));
});

test("GET schedule-domains requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateListDomains(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("GET schedule-domains returns pending domains", () => {
  const supabase = createSupabaseStub();
  const result = simulateListDomains(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    {
      supabase,
      pendingDomains: [
        { id: "domain-1", hostname: "athletics.example.com", status: "pending", verified_by_org_id: "org-1", vendor_id: "vendorA" },
        { id: "domain-2", hostname: "schedule.other.com", status: "pending", verified_by_org_id: "org-2" }, // Different org
        { id: "domain-3", hostname: "active.example.com", status: "active", verified_by_org_id: "org-1" }, // Already active
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.domains?.length, 1);
  assert.strictEqual(result.domains?.[0].hostname, "athletics.example.com");
});

test("GET schedule-domains returns empty array when no pending", () => {
  const supabase = createSupabaseStub();
  const result = simulateListDomains(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase, pendingDomains: [] }
  );
  assert.strictEqual(result.status, 200);
  assert.deepStrictEqual(result.domains, []);
});

// ==============================================================
// POST /api/admin/schedule-domains/[domainId]/approve
// ==============================================================

function simulateApproveDomain(
  request: DomainRequest,
  ctx: DomainContext
): DomainActionResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to approve domains." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can approve schedule domains." };
  }

  if (!ctx.domain) {
    return { status: 404, error: "Not found", message: "Schedule domain not found." };
  }

  if (ctx.domain.verified_by_org_id !== request.orgId) {
    return { status: 403, error: "Forbidden", message: "This domain was not requested by your organization." };
  }

  return {
    status: 200,
    domain: {
      id: ctx.domain.id,
      hostname: ctx.domain.hostname,
      status: "active",
    },
  };
}

test("approve domain requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 401);
});

test("approve domain requires orgId", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.orgAdmin("org-1"), domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 400);
});

test("approve domain requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 403);
});

test("approve domain returns 404 for non-existent domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-nonexistent" },
    { supabase, domain: undefined }
  );
  assert.strictEqual(result.status, 404);
});

test("approve domain rejects domain from different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-2" } }
  );
  assert.strictEqual(result.status, 403);
  assert.ok(result.message?.includes("not requested by your organization"));
});

test("approve domain succeeds and returns active status", () => {
  const supabase = createSupabaseStub();
  const result = simulateApproveDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "athletics.example.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.domain?.status, "active");
  assert.strictEqual(result.domain?.hostname, "athletics.example.com");
});

// ==============================================================
// POST /api/admin/schedule-domains/[domainId]/block
// ==============================================================

function simulateBlockDomain(
  request: DomainRequest,
  ctx: DomainContext
): DomainActionResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to block domains." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can block schedule domains." };
  }

  if (!ctx.domain) {
    return { status: 404, error: "Not found", message: "Schedule domain not found." };
  }

  if (ctx.domain.verified_by_org_id !== request.orgId) {
    return { status: 403, error: "Forbidden", message: "This domain was not requested by your organization." };
  }

  // Count matching sources that would be disabled
  const disabledSources = (ctx.matchingSources || []).filter((source) => {
    try {
      return new URL(source.source_url).hostname === ctx.domain?.hostname;
    } catch {
      return false;
    }
  }).length;

  return {
    status: 200,
    domain: {
      id: ctx.domain.id,
      hostname: ctx.domain.hostname,
      status: "blocked",
    },
    disabledSources,
  };
}

test("block domain requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 401);
});

test("block domain requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.orgAlumni("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 403);
});

test("block domain returns 404 for non-existent domain", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: undefined }
  );
  assert.strictEqual(result.status, 404);
});

test("block domain rejects domain from different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "test.com", status: "pending", verified_by_org_id: "org-2" } }
  );
  assert.strictEqual(result.status, 403);
});

test("block domain succeeds and returns blocked status", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    { supabase, domain: { id: "domain-1", hostname: "malicious.example.com", status: "pending", verified_by_org_id: "org-1" } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.domain?.status, "blocked");
});

test("block domain disables matching sources", () => {
  const supabase = createSupabaseStub();
  const result = simulateBlockDomain(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", domainId: "domain-1" },
    {
      supabase,
      domain: { id: "domain-1", hostname: "bad.example.com", status: "pending", verified_by_org_id: "org-1" },
      matchingSources: [
        { id: "source-1", source_url: "https://bad.example.com/schedule.ics" },
        { id: "source-2", source_url: "https://bad.example.com/calendar" },
        { id: "source-3", source_url: "https://other.example.com/schedule" }, // Different domain
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.disabledSources, 2);
});
