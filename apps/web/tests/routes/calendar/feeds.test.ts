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
 * Tests for personal calendar feeds routes:
 * - GET /api/calendar/feeds (list personal feeds)
 * - POST /api/calendar/feeds (add personal feed)
 * - DELETE /api/calendar/feeds/[feedId] (remove personal feed)
 */

// Types
interface FeedRequest {
  auth: AuthContext;
  organizationId?: string;
  feedUrl?: string;
  provider?: string;
  feedId?: string;
}

interface ListFeedsResult {
  status: number;
  feeds?: Array<{
    id: string;
    maskedUrl: string;
    status: string;
    last_synced_at: string | null;
    last_error: string | null;
    provider: string;
  }>;
  error?: string;
  message?: string;
}

interface CreateFeedResult {
  status: number;
  id?: string;
  maskedUrl?: string;
  status_?: string;
  provider?: string;
  error?: string;
  message?: string;
}

interface DeleteFeedResult {
  status: number;
  success?: boolean;
  error?: string;
  message?: string;
}

interface FeedContext {
  supabase?: unknown;
  feeds?: Array<{
    id: string;
    feed_url: string;
    status: string;
    user_id: string;
    organization_id: string;
    scope: "personal" | "organization";
    last_synced_at: string | null;
    last_error: string | null;
    provider: string;
  }>;
}

function maskFeedUrl(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl);
    const tail = feedUrl.slice(-6);
    return `${parsed.host}/...${tail}`;
  } catch {
    return "hidden";
  }
}

// ==============================================================
// GET /api/calendar/feeds
// ==============================================================

function simulateListFeeds(
  request: FeedRequest,
  ctx?: FeedContext
): ListFeedsResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to view feeds." };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Missing parameter", message: "organizationId is required." };
  }

  if (!hasOrgMembership(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  const userId = request.auth.user?.id;
  const feeds = (ctx.feeds || [])
    .filter((f) => f.user_id === userId && f.organization_id === request.organizationId && f.scope === "personal")
    .map((f) => ({
      id: f.id,
      maskedUrl: maskFeedUrl(f.feed_url),
      status: f.status,
      last_synced_at: f.last_synced_at,
      last_error: f.last_error,
      provider: f.provider,
    }));

  return { status: 200, feeds };
}

test("GET feeds requires authentication", () => {
  const result = simulateListFeeds(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1" },
  );
  assert.strictEqual(result.status, 401);
});

test("GET feeds requires organizationId", () => {
  const result = simulateListFeeds(
    { auth: AuthPresets.orgMember("org-1") },
  );
  assert.strictEqual(result.status, 400);
});

test("GET feeds requires org membership", () => {
  const result = simulateListFeeds(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1" },
  );
  assert.strictEqual(result.status, 403);
});

test("GET feeds returns user's personal feeds", () => {
  const supabase = createSupabaseStub();
  const result = simulateListFeeds(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    {
      supabase,
      feeds: [
        { id: "feed-1", feed_url: "https://calendar.google.com/calendar/ical/abc123/basic.ics", status: "active", user_id: "member-user", organization_id: "org-1", scope: "personal", last_synced_at: null, last_error: null, provider: "ics" },
        { id: "feed-2", feed_url: "https://example.com/other.ics", status: "active", user_id: "other-user", organization_id: "org-1", scope: "personal", last_synced_at: null, last_error: null, provider: "ics" }, // Different user
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.feeds?.length, 1);
  assert.strictEqual(result.feeds?.[0].id, "feed-1");
});

test("GET feeds masks URL in response", () => {
  const supabase = createSupabaseStub();
  const result = simulateListFeeds(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
    {
      supabase,
      feeds: [
        { id: "feed-1", feed_url: "https://calendar.google.com/calendar/ical/secret123/basic.ics", status: "active", user_id: "member-user", organization_id: "org-1", scope: "personal", last_synced_at: null, last_error: null, provider: "ics" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.ok(result.feeds?.[0].maskedUrl.includes("calendar.google.com"));
  assert.ok(!result.feeds?.[0].maskedUrl.includes("secret123"));
});

// ==============================================================
// POST /api/calendar/feeds
// ==============================================================

function isValidFeedUrl(url: string): { valid: boolean; normalized?: string; error?: string } {
  if (!url) return { valid: false, error: "feedUrl is required." };
  let trimmed = url.trim();

  // Handle webcal:// protocol
  if (trimmed.startsWith("webcal://")) {
    trimmed = `https://${trimmed.slice("webcal://".length)}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "Feed URL must start with http(s) or webcal." };
    }
    return { valid: true, normalized: parsed.toString() };
  } catch {
    return { valid: false, error: "Invalid feed URL." };
  }
}

function isLikelyIcsUrl(feedUrl: string): boolean {
  const lower = feedUrl.toLowerCase();
  return lower.includes(".ics") || lower.includes("ical") || lower.includes("calendar");
}

function simulateCreateFeed(
  request: FeedRequest
): CreateFeedResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to add a feed." };
  }

  if (!request.feedUrl) {
    return { status: 400, error: "Missing feedUrl", message: "feedUrl is required." };
  }

  if (!request.organizationId) {
    return { status: 400, error: "Missing organizationId", message: "organizationId is required." };
  }

  if (!hasOrgMembership(request.auth, request.organizationId)) {
    return { status: 403, error: "Forbidden", message: "You are not a member of this organization." };
  }

  const urlValidation = isValidFeedUrl(request.feedUrl);
  if (!urlValidation.valid) {
    return { status: 400, error: "Invalid feedUrl", message: urlValidation.error };
  }

  if (!isLikelyIcsUrl(urlValidation.normalized!)) {
    return { status: 400, error: "Invalid feedUrl", message: "Feed URL does not look like an ICS calendar link." };
  }

  return {
    status: 201,
    id: "feed-new-123",
    maskedUrl: maskFeedUrl(urlValidation.normalized!),
    status_: "active",
    provider: request.provider || "ics",
  };
}

test("POST feed requires authentication", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", feedUrl: "https://example.com/calendar.ics" }
  );
  assert.strictEqual(result.status, 401);
});

test("POST feed requires feedUrl", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1" },
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("feedUrl"));
});

test("POST feed requires organizationId", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), feedUrl: "https://example.com/calendar.ics" },
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("organizationId"));
});

test("POST feed requires org membership", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.authenticatedNoOrg, organizationId: "org-1", feedUrl: "https://example.com/calendar.ics" },
  );
  assert.strictEqual(result.status, 403);
});

test("POST feed validates URL protocol", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", feedUrl: "ftp://example.com/calendar.ics" },
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("http"));
});

test("POST feed rejects non-ICS URLs", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", feedUrl: "https://example.com/random-page" },
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.message?.includes("ICS"));
});

test("POST feed normalizes webcal:// protocol", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", feedUrl: "webcal://calendar.google.com/calendar/ical/abc/basic.ics" },
  );
  assert.strictEqual(result.status, 201);
});

test("POST feed creates feed successfully", () => {
  const result = simulateCreateFeed(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", feedUrl: "https://calendar.google.com/calendar/ical/abc/basic.ics" },
  );
  assert.strictEqual(result.status, 201);
  assert.ok(result.id);
  assert.ok(result.maskedUrl);
});

// ==============================================================
// DELETE /api/calendar/feeds/[feedId]
// ==============================================================

function simulateDeleteFeed(
  request: FeedRequest,
  ctx?: FeedContext
): DeleteFeedResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized", message: "You must be logged in to remove feeds." };
  }

  if (!request.feedId) {
    return { status: 400, error: "Missing feedId", message: "feedId is required." };
  }

  const userId = request.auth.user?.id;
  const feed = (ctx.feeds || []).find(
    (f) => f.id === request.feedId && f.user_id === userId && f.scope === "personal"
  );

  if (!feed) {
    return { status: 404, error: "Not found", message: "Feed not found." };
  }

  return { status: 200, success: true };
}

test("DELETE feed requires authentication", () => {
  const result = simulateDeleteFeed(
    { auth: AuthPresets.unauthenticated, feedId: "feed-1" },
  );
  assert.strictEqual(result.status, 401);
});

test("DELETE feed returns 404 for non-existent feed", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteFeed(
    { auth: AuthPresets.orgMember("org-1"), feedId: "feed-nonexistent" },
    { supabase, feeds: [] }
  );
  assert.strictEqual(result.status, 404);
});

test("DELETE feed returns 404 for other user's feed", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteFeed(
    { auth: AuthPresets.orgMember("org-1"), feedId: "feed-1" },
    {
      supabase,
      feeds: [
        { id: "feed-1", feed_url: "https://example.com/cal.ics", status: "active", user_id: "other-user", organization_id: "org-1", scope: "personal", last_synced_at: null, last_error: null, provider: "ics" },
      ],
    }
  );
  assert.strictEqual(result.status, 404);
});

test("DELETE feed succeeds for own feed", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteFeed(
    { auth: AuthPresets.orgMember("org-1"), feedId: "feed-1" },
    {
      supabase,
      feeds: [
        { id: "feed-1", feed_url: "https://example.com/cal.ics", status: "active", user_id: "member-user", organization_id: "org-1", scope: "personal", last_synced_at: null, last_error: null, provider: "ics" },
      ],
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("DELETE feed cannot delete org-scope feed", () => {
  const supabase = createSupabaseStub();
  const result = simulateDeleteFeed(
    { auth: AuthPresets.orgAdmin("org-1"), feedId: "feed-1" },
    {
      supabase,
      feeds: [
        { id: "feed-1", feed_url: "https://example.com/cal.ics", status: "active", user_id: "admin-user", organization_id: "org-1", scope: "organization", last_synced_at: null, last_error: null, provider: "ics" },
      ],
    }
  );
  assert.strictEqual(result.status, 404); // Can't find as personal scope
});
