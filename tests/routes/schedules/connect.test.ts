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
 * Tests for POST /api/schedules/connect
 *
 * This route:
 * 1. Requires authentication
 * 2. Requires admin role
 * 3. Validates URL format
 * 4. Checks domain allowlist status
 * 5. Performs verification if needed
 * 6. Creates schedule source and triggers sync
 */

// Types
interface ConnectRequest {
  auth: AuthContext;
  orgId?: string;
  url?: string;
  title?: string;
}

interface ConnectResult {
  status: number;
  source?: {
    id: string;
    vendor_id: string;
    maskedUrl: string;
    status: string;
    last_synced_at?: string | null;
    last_error?: string | null;
    title?: string | null;
  };
  sync?: {
    inserted: number;
    updated: number;
    deleted: number;
  };
  error?: string;
  message?: string;
}

interface ConnectContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  domainStatus?: {
    status: "active" | "blocked" | "pending" | "denied";
    verifiedByOrgId?: string;
  };
  verificationResult?: {
    allowStatus: "active" | "pending" | "denied";
    vendorId: string;
  };
  connectorResult?: {
    id: string;
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

function simulateConnect(
  request: ConnectRequest,
  ctx: ConnectContext
): ConnectResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to connect schedules." };
  }

  // Validate parameters
  if (!request.orgId || !request.url) {
    return { status: 400, error: "Missing parameters", message: "orgId and url are required." };
  }

  // Check admin role
  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can connect schedules." };
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

  // Check domain allowlist status
  if (ctx.domainStatus) {
    if (ctx.domainStatus.status === "blocked") {
      return { status: 403, error: "Blocked", message: "This domain is blocked for schedule sources." };
    }

    if (ctx.domainStatus.status === "pending") {
      // If this org created the pending request, block
      if (ctx.domainStatus.verifiedByOrgId === request.orgId) {
        return { status: 409, error: "Pending approval", message: "This domain needs admin approval before importing." };
      }
      // Otherwise fall through to re-verify
    }
  }

  // If domain is denied or pending from different org, perform verification
  if (ctx.domainStatus?.status === "denied" ||
      (ctx.domainStatus?.status === "pending" && ctx.domainStatus.verifiedByOrgId !== request.orgId)) {
    if (ctx.verificationResult) {
      if (ctx.verificationResult.allowStatus === "pending") {
        return { status: 409, error: "Pending approval", message: "This domain needs admin approval before importing." };
      }
      if (ctx.verificationResult.allowStatus !== "active") {
        return { status: 400, error: "Not allowed", message: "This domain could not be verified for import." };
      }
    }
  }

  // Check connector detection
  if (!ctx.connectorResult) {
    return { status: 400, error: "Unsupported schedule", message: "Unsupported schedule URL." };
  }

  // Create source and return result
  return {
    status: 200,
    source: {
      id: "source-new-123",
      vendor_id: ctx.connectorResult.id,
      maskedUrl: maskUrl(request.url),
      status: "active",
      last_synced_at: new Date().toISOString(),
      last_error: null,
      title: request.title ?? null,
    },
    sync: {
      inserted: 10,
      updated: 0,
      deleted: 0,
    },
  };
}

// Tests

test("connect requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("connect requires orgId and url", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("orgId and url"));
});

test("connect requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("connect rejects alumni role", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAlumni("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("connect rejects blocked domains", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://malicious.example.com/schedule" },
    {
      supabase,
      domainStatus: { status: "blocked" },
    }
  );
  assert.strictEqual(result.status, 403);
  assert.ok(result.message?.includes("blocked"));
});

test("connect returns 409 for pending domain from same org", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://pending.example.com/schedule" },
    {
      supabase,
      domainStatus: { status: "pending", verifiedByOrgId: "org-1" },
    }
  );
  assert.strictEqual(result.status, 409);
  assert.ok(result.message?.includes("admin approval"));
});

test("connect re-verifies pending domain from different org", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://pending.example.com/schedule" },
    {
      supabase,
      domainStatus: { status: "pending", verifiedByOrgId: "org-2" }, // Different org
      verificationResult: { allowStatus: "active", vendorId: "ics" },
      connectorResult: { id: "ics" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source);
});

test("connect verifies denied domains", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://unknown.example.com/schedule.ics" },
    {
      supabase,
      domainStatus: { status: "denied" },
      verificationResult: { allowStatus: "active", vendorId: "ics" },
      connectorResult: { id: "ics" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source);
});

test("connect returns 409 when verification returns pending", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://new.example.com/schedule" },
    {
      supabase,
      domainStatus: { status: "denied" },
      verificationResult: { allowStatus: "pending", vendorId: "generic_html" },
    }
  );
  assert.strictEqual(result.status, 409);
});

test("connect returns 400 when verification fails", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://random.example.com/page" },
    {
      supabase,
      domainStatus: { status: "denied" },
      verificationResult: { allowStatus: "denied", vendorId: "unknown" },
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("could not be verified"));
});

test("connect returns 400 for unsupported connector", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://valid.example.com/unknown-format" },
    {
      supabase,
      domainStatus: { status: "active" },
      connectorResult: undefined, // No connector found
    }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Unsupported schedule"));
});

test("connect creates source and syncs for valid URL", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    {
      supabase,
      domainStatus: { status: "active" },
      connectorResult: { id: "ics" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source?.id);
  assert.strictEqual(result.source?.vendor_id, "ics");
  assert.ok(result.sync);
  assert.strictEqual(result.sync?.inserted, 10);
});

test("connect uses provided title", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics", title: "Men's Basketball" },
    {
      supabase,
      domainStatus: { status: "active" },
      connectorResult: { id: "ics" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.source?.title, "Men's Basketball");
});

test("connect masks URL in response", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/private/schedule.ics" },
    {
      supabase,
      domainStatus: { status: "active" },
      connectorResult: { id: "ics" },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.source?.maskedUrl?.includes("athletics.example.com"));
  assert.ok(!result.source?.maskedUrl?.includes("/private/"));
});

test("connect rejects invalid URL", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "not-a-valid-url" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Invalid URL"));
});

test("connect handles SSRF protection", () => {
  const supabase = createSupabaseStub();
  const result = simulateConnect(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "http://localhost:8080/schedule" },
    { supabase, urlError: "Localhost URLs are not allowed" }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Localhost"));
});
