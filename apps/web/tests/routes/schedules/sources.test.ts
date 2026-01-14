import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  hasOrgMembership,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for schedule sources routes:
 * - GET /api/schedules/sources (list sources)
 * - DELETE /api/schedules/sources/[sourceId]
 * - POST /api/schedules/sources/[sourceId]/sync
 */

// Types
interface SourcesRequest {
  auth: AuthContext;
  orgId?: string;
  sourceId?: string;
}

interface ListSourcesResult {
  status: number;
  sources?: Array<{
    id: string;
    vendor_id: string;
    maskedUrl: string;
    status: string;
    title: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  }>;
  error?: string;
  message?: string;
}

interface DeleteSourceResult {
  status: number;
  success?: boolean;
  error?: string;
  message?: string;
}

interface SyncSourceResult {
  status: number;
  inserted?: number;
  updated?: number;
  deleted?: number;
  error?: string;
  message?: string;
}

interface SourcesContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  sources?: Array<{
    id: string;
    org_id: string;
    vendor_id: string;
    source_url: string;
    status: string;
    title: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  }>;
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

// ==============================================================
// GET /api/schedules/sources
// ==============================================================

function simulateListSources(
  request: SourcesRequest,
  ctx: SourcesContext
): ListSourcesResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to view schedule sources." };
  }

  if (!request.orgId) {
    return { status: 400, error: "Missing parameters", message: "orgId is required." };
  }

  if (!hasOrgMembership(request.auth, request.orgId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  const sources = (ctx.sources || [])
    .filter((s) => s.org_id === request.orgId)
    .map((s) => ({
      id: s.id,
      vendor_id: s.vendor_id,
      maskedUrl: maskUrl(s.source_url),
      status: s.status,
      title: s.title,
      last_synced_at: s.last_synced_at,
      last_error: s.last_error,
    }));

  return { status: 200, sources };
}

test("GET sources requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateListSources(
    { auth: AuthPresets.unauthenticated, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("GET sources requires orgId", () => {
  const supabase = createSupabaseStub();
  const result = simulateListSources(
    { auth: AuthPresets.orgMember("org-1") },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
});

test("GET sources requires org membership", () => {
  const supabase = createSupabaseStub();
  const result = simulateListSources(
    { auth: AuthPresets.authenticatedNoOrg, orgId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 403);
});

test("GET sources returns org sources", () => {
  const supabase = createSupabaseStub();
  const result = simulateListSources(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://example.com/schedule.ics", status: "active", title: "Main Schedule", last_synced_at: "2024-01-15T10:00:00Z", last_error: null },
        { id: "src-2", org_id: "org-2", vendor_id: "ics", source_url: "https://other.com/cal.ics", status: "active", title: null, last_synced_at: null, last_error: null }, // Different org
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.sources?.length, 1);
  assert.strictEqual(result.sources?.[0].id, "src-1");
});

test("GET sources masks URLs", () => {
  const supabase = createSupabaseStub();
  const result = simulateListSources(
    { auth: AuthPresets.orgMember("org-1"), orgId: "org-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://private.example.com/secret/schedule.ics", status: "active", title: null, last_synced_at: null, last_error: null },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.sources?.[0].maskedUrl.includes("private.example.com"));
  assert.ok(!result.sources?.[0].maskedUrl.includes("secret"));
});

// ==============================================================
// DELETE /api/schedules/sources/[sourceId]
// ==============================================================

function simulateDeleteSource(
  request: SourcesRequest,
  ctx: SourcesContext
): DeleteSourceResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to remove schedule sources." };
  }

  if (!request.sourceId) {
    return { status: 400, error: "Missing parameters", message: "sourceId is required." };
  }

  const source = (ctx.sources || []).find((s) => s.id === request.sourceId);
  if (!source) {
    return { status: 404, error: "Not found", message: "Schedule source not found." };
  }

  if (!isOrgAdmin(request.auth, source.org_id)) {
    return { status: 403, error: "Forbidden", message: "Only admins can delete schedule sources." };
  }

  return { status: 200, success: true };
}

test("DELETE source requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteSource(
    { auth: AuthPresets.unauthenticated, sourceId: "src-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("DELETE source returns 404 for non-existent source", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteSource(
    { auth: AuthPresets.orgAdmin("org-1"), sourceId: "src-nonexistent" },
    { supabase, sources: [] }
  );
  assert.strictEqual(result.status, 404);
});

test("DELETE source requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteSource(
    { auth: AuthPresets.orgMember("org-1"), sourceId: "src-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://example.com/cal.ics", status: "active", title: null, last_synced_at: null, last_error: null },
      ],
    }
  );
  assert.strictEqual(result.status, 403);
});

test("DELETE source succeeds for admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteSource(
    { auth: AuthPresets.orgAdmin("org-1"), sourceId: "src-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://example.com/cal.ics", status: "active", title: null, last_synced_at: null, last_error: null },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

// ==============================================================
// POST /api/schedules/sources/[sourceId]/sync
// ==============================================================

function simulateSyncSource(
  request: SourcesRequest,
  ctx: SourcesContext
): SyncSourceResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to sync schedule sources." };
  }

  if (!request.sourceId) {
    return { status: 400, error: "Missing parameters", message: "sourceId is required." };
  }

  const source = (ctx.sources || []).find((s) => s.id === request.sourceId);
  if (!source) {
    return { status: 404, error: "Not found", message: "Schedule source not found." };
  }

  if (!isOrgAdmin(request.auth, source.org_id)) {
    return { status: 403, error: "Forbidden", message: "Only admins can sync schedule sources." };
  }

  // Simulate sync result
  return {
    status: 200,
    inserted: 5,
    updated: 2,
    deleted: 1,
  };
}

test("sync source requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateSyncSource(
    { auth: AuthPresets.unauthenticated, sourceId: "src-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("sync source returns 404 for non-existent source", () => {
  const supabase = createSupabaseStub();
  const result = simulateSyncSource(
    { auth: AuthPresets.orgAdmin("org-1"), sourceId: "src-nonexistent" },
    { supabase, sources: [] }
  );
  assert.strictEqual(result.status, 404);
});

test("sync source requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateSyncSource(
    { auth: AuthPresets.orgMember("org-1"), sourceId: "src-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://example.com/cal.ics", status: "active", title: null, last_synced_at: null, last_error: null },
      ],
    }
  );
  assert.strictEqual(result.status, 403);
});

test("sync source succeeds for admin", () => {
  const supabase = createSupabaseStub();
  const result = simulateSyncSource(
    { auth: AuthPresets.orgAdmin("org-1"), sourceId: "src-1" },
    {
      supabase,
      sources: [
        { id: "src-1", org_id: "org-1", vendor_id: "ics", source_url: "https://example.com/cal.ics", status: "active", title: null, last_synced_at: null, last_error: null },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.inserted !== undefined);
  assert.ok(result.updated !== undefined);
  assert.ok(result.deleted !== undefined);
});
