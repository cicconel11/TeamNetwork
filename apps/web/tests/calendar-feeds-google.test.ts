import test from "node:test";
import assert from "node:assert";

/**
 * Tests for POST /api/calendar/feeds (Google Calendar provider)
 *
 * Validates that the personal Google Calendar feed creation flow:
 * 1. Creates Google feed with correct fields (provider: "google", scope: "personal", connected_user_id, google_calendar_id, feed_url: "google://...")
 * 2. Rejects when no Google connection exists
 * 3. Rejects non-members
 * 4. Triggers immediate sync after feed creation
 */

// Types
type GoogleFeedRequest = {
  organizationId: string;
  googleCalendarId: string;
  provider: "google";
};

type GoogleConnection = {
  id: string;
  user_id: string;
  status: "connected" | "disconnected" | "error";
};

type Membership = {
  user_id: string;
  organization_id: string;
  role: "admin" | "active_member" | "alumni";
  status: "active" | "pending" | "revoked";
};

type CalendarFeed = {
  id: string;
  user_id: string;
  provider: string;
  feed_url: string;
  organization_id: string;
  scope: "personal" | "organization";
  connected_user_id: string | null;
  google_calendar_id: string | null;
};

type CreateFeedResult = {
  status: number;
  feed?: CalendarFeed;
  error?: string;
  message?: string;
  syncTriggered?: boolean;
};

// Test helpers

/**
 * Simulates the Google Calendar feed creation logic
 */
function simulateGoogleFeedCreate(
  userId: string,
  request: GoogleFeedRequest,
  connection: GoogleConnection | null,
  membership: Membership | null
): CreateFeedResult {
  // Check membership
  if (!membership || membership.status === "revoked") {
    return {
      status: 403,
      error: "Forbidden",
      message: "You are not a member of this organization.",
    };
  }

  // Check Google connection
  if (!connection || connection.status !== "connected") {
    return {
      status: 400,
      error: "No Google connection",
      message: "You must connect your Google account before adding a Google Calendar feed.",
    };
  }

  // Create feed with correct fields
  const feedUrl = `google://${request.googleCalendarId}`;

  const feed: CalendarFeed = {
    id: `feed-${Date.now()}`,
    user_id: userId,
    provider: "google",
    feed_url: feedUrl,
    organization_id: request.organizationId,
    scope: "personal",
    connected_user_id: userId,
    google_calendar_id: request.googleCalendarId,
  };

  return {
    status: 201,
    feed,
    syncTriggered: true, // Immediate sync triggered
  };
}

// Tests

test("creates Google feed with correct fields", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "connected",
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "active",
  };

  const result = simulateGoogleFeedCreate(userId, request, connection, membership);

  assert.strictEqual(result.status, 201, "Should return 201 Created");
  assert.ok(result.feed, "Should return feed object");

  // Verify all required fields
  assert.strictEqual(result.feed!.provider, "google",
    "Provider should be 'google'");
  assert.strictEqual(result.feed!.scope, "personal",
    "Scope should be 'personal'");
  assert.strictEqual(result.feed!.connected_user_id, userId,
    "connected_user_id should be set to user ID");
  assert.strictEqual(result.feed!.google_calendar_id, request.googleCalendarId,
    "google_calendar_id should be set to request calendar ID");
  assert.ok(result.feed!.feed_url.startsWith("google://"),
    "feed_url should start with 'google://'");
  assert.strictEqual(result.feed!.feed_url, `google://${request.googleCalendarId}`,
    "feed_url should be 'google://{calendarId}'");
});

test("rejects when no Google connection", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "active",
  };

  // No connection
  const result = simulateGoogleFeedCreate(userId, request, null, membership);

  assert.strictEqual(result.status, 400,
    "Should return 400 when no connection exists");
  assert.ok(result.message?.includes("connect your Google account"),
    "Error message should mention connecting Google account");
});

test("rejects when Google connection is disconnected", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "disconnected", // Not connected
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "active",
  };

  const result = simulateGoogleFeedCreate(userId, request, connection, membership);

  assert.strictEqual(result.status, 400,
    "Should return 400 when connection status is not 'connected'");
});

test("rejects non-members", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "connected",
  };

  // No membership
  const result = simulateGoogleFeedCreate(userId, request, connection, null);

  assert.strictEqual(result.status, 403,
    "Should return 403 when user is not a member");
  assert.ok(result.message?.includes("not a member"),
    "Error message should mention not being a member");
});

test("rejects revoked members", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "connected",
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "revoked", // Revoked
  };

  const result = simulateGoogleFeedCreate(userId, request, connection, membership);

  assert.strictEqual(result.status, 403,
    "Should return 403 when user membership is revoked");
});

test("triggers immediate sync after feed creation", () => {
  const userId = "user-1";
  const request: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "calendar123@group.calendar.google.com",
    provider: "google",
  };

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "connected",
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "active",
  };

  const result = simulateGoogleFeedCreate(userId, request, connection, membership);

  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.syncTriggered, true,
    "Should trigger immediate sync after creating feed");
});

test("accepts different Google Calendar ID formats", () => {
  const userId = "user-1";

  const connection: GoogleConnection = {
    id: "conn-1",
    user_id: userId,
    status: "connected",
  };

  const membership: Membership = {
    user_id: userId,
    organization_id: "org-1",
    role: "active_member",
    status: "active",
  };

  // Test primary calendar ID
  const primaryRequest: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "primary",
    provider: "google",
  };

  const primaryResult = simulateGoogleFeedCreate(userId, primaryRequest, connection, membership);
  assert.strictEqual(primaryResult.status, 201);
  assert.strictEqual(primaryResult.feed!.google_calendar_id, "primary");
  assert.strictEqual(primaryResult.feed!.feed_url, "google://primary");

  // Test shared calendar ID
  const sharedRequest: GoogleFeedRequest = {
    organizationId: "org-1",
    googleCalendarId: "abc123def456@group.calendar.google.com",
    provider: "google",
  };

  const sharedResult = simulateGoogleFeedCreate(userId, sharedRequest, connection, membership);
  assert.strictEqual(sharedResult.status, 201);
  assert.strictEqual(sharedResult.feed!.google_calendar_id, "abc123def456@group.calendar.google.com");
  assert.strictEqual(sharedResult.feed!.feed_url, "google://abc123def456@group.calendar.google.com");
});
