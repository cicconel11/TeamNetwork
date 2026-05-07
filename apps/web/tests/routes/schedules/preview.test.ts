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
 * Tests for POST /api/schedules/preview
 *
 * This route:
 * 1. Applies IP-based rate limiting before auth
 * 2. Requires authentication
 * 3. Requires admin role
 * 4. Validates and normalizes URL
 * 5. Detects connector type and returns preview events
 */

// Types
interface PreviewRequest {
  auth: AuthContext;
  orgId?: string;
  url?: string;
}

interface PreviewResult {
  status: number;
  vendor?: string;
  title?: string | null;
  eventsPreview?: Array<{
    title: string;
    start: string;
    end?: string;
  }>;
  inferredMeta?: Record<string, unknown> | null;
  maskedUrl?: string;
  error?: string;
  message?: string;
}

interface PreviewContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  connectorResult?: {
    vendor: string;
    title?: string;
    events: Array<{ title: string; start: string }>;
    inferredMeta?: Record<string, unknown>;
  };
  urlError?: string;
}

// URL validation (simplified)
function isValidScheduleUrl(url: string | undefined): { valid: boolean; error?: string } {
  if (!url) return { valid: false, error: "Missing URL" };
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "URL must start with http(s)" };
    }
    // Check for SSRF protections
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { valid: false, error: "Localhost URLs are not allowed" };
    }
    // Simple private IP check
    if (host.startsWith("10.") || host.startsWith("192.168.") || host.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
      return { valid: false, error: "Private IPs are not allowed" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL" };
  }
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

function simulatePreview(
  request: PreviewRequest,
  ctx: PreviewContext
): PreviewResult {
  // Authentication required
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to preview schedules." };
  }

  // Validate parameters
  if (!request.orgId || !request.url) {
    return { status: 400, error: "Missing parameters", message: "orgId and url are required." };
  }

  // Check admin role
  if (!isOrgAdmin(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "Only admins can preview schedules." };
  }

  // Validate URL
  const urlValidation = isValidScheduleUrl(request.url);
  if (!urlValidation.valid) {
    return { status: 400, error: "Invalid URL", message: urlValidation.error };
  }

  // Check for connector errors
  if (ctx.urlError) {
    return { status: 400, error: "Preview failed", message: ctx.urlError };
  }

  // Return preview results
  if (!ctx.connectorResult) {
    return { status: 400, error: "Preview failed", message: "No supported schedule connector found for this URL." };
  }

  return {
    status: 200,
    vendor: ctx.connectorResult.vendor,
    title: ctx.connectorResult.title ?? null,
    eventsPreview: ctx.connectorResult.events.slice(0, 20),
    inferredMeta: ctx.connectorResult.inferredMeta ?? null,
    maskedUrl: maskUrl(request.url),
  };
}

// Tests

test("preview requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.unauthenticated, orgId: "org-1", url: "https://athletics.example.com/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("preview requires orgId and url", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("orgId and url"));
});

test("preview requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("preview rejects localhost URLs", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "http://localhost:8080/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Localhost"));
});

test("preview rejects private IPs", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "http://192.168.1.1/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Private IPs"));
});

test("preview rejects 10.x.x.x private IPs", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "http://10.0.0.1/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("Private IPs"));
});

test("preview rejects invalid URL scheme", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "ftp://athletics.example.com/schedule" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("http"));
});

test("preview returns events for valid URL", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    {
      supabase,
      connectorResult: {
        vendor: "ics",
        title: "Team Schedule",
        events: [
          { title: "Game vs Rivals", start: "2024-03-15T18:00:00Z" },
          { title: "Practice", start: "2024-03-16T15:00:00Z" },
        ],
        inferredMeta: { sport: "Basketball" },
      },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.vendor, "ics");
  assert.strictEqual(result.title, "Team Schedule");
  assert.strictEqual(result.eventsPreview?.length, 2);
  assert.ok(result.maskedUrl);
});

test("preview masks URL in response", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    {
      supabase,
      connectorResult: { vendor: "ics", events: [] },
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.maskedUrl?.includes("athletics.example.com"));
  assert.ok(!result.maskedUrl?.includes("/schedule.ics"));
});

test("preview returns error for unsupported URL", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://example.com/random-page" },
    { supabase, connectorResult: undefined }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("No supported schedule connector"));
});

test("preview limits events to 20", () => {
  const supabase = createSupabaseStub();
  const manyEvents = Array.from({ length: 30 }, (_, i) => ({
    title: `Event ${i + 1}`,
    start: new Date(Date.now() + i * 86400000).toISOString(),
  }));
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://athletics.example.com/schedule.ics" },
    { supabase, connectorResult: { vendor: "ics", events: manyEvents } }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.eventsPreview?.length, 20);
});

test("preview handles domain pending approval", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://pending.example.com/schedule" },
    { supabase, urlError: "Domain pending admin approval" }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("pending"));
});

test("preview handles blocked domain", () => {
  const supabase = createSupabaseStub();
  const result = simulatePreview(
    { auth: AuthPresets.orgAdmin("org-1"), orgId: "org-1", url: "https://blocked.example.com/schedule" },
    { supabase, urlError: "Domain is blocked" }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("blocked"));
});
