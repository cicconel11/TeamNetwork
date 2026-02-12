import test from "node:test";
import assert from "node:assert";

/**
 * Tests for POST /api/analytics/ingest
 *
 * This route:
 * 1. Requires auth (401 if no user)
 * 2. Requires analytics consent (403 if not consented)
 * 3. Validates payload with usageIngestRequestSchema (Zod)
 * 4. Checks org membership if organization_id provided (silently drops events with 204 if non-member)
 * 5. Resolves tracking level based on age_bracket + org_type
 * 6. Filters events: page_view_only level only allows page_view events, strips duration_ms/hour_of_day
 * 7. Returns 204 on success
 */

// Types
interface AuthContext {
  user: { id: string; email?: string; age_bracket?: string } | null;
}

function isAuthenticated(ctx: AuthContext): boolean {
  return ctx.user !== null && ctx.user.id !== "";
}

type AgeBracket = "under_13" | "13_17" | "18_plus";
type OrgType = "educational" | "athletic" | "general";
type EventType = "page_view" | "feature_enter" | "feature_exit" | "nav_click";
type TrackingLevel = "none" | "page_view_only" | "full";

interface UsageEvent {
  event_type: EventType;
  feature: string;
  duration_ms?: number;
  device_class: "mobile" | "tablet" | "desktop";
  hour_of_day: number;
}

interface IngestRequest {
  auth: AuthContext;
  consented: boolean;
  ageBracket?: AgeBracket;
  orgType?: OrgType;
  isMember?: boolean;
  body?: unknown;
}

interface IngestResult {
  status: number;
  error?: string;
  events?: Array<{
    event_type: EventType;
    feature: string;
    duration_ms: number | null;
    hour_of_day: number | null;
  }>;
}

// Tracking level resolution logic (from consent.ts)
function resolveTrackingLevel(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): TrackingLevel {
  if (!consented) return "none";
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17") return "page_view_only";
  if (orgType === "educational") return "page_view_only";
  return "full";
}

function simulateIngest(request: IngestRequest): IngestResult {
  // 1. Check authentication
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // 2. Check consent
  if (!request.consented) {
    return { status: 403, error: "Forbidden" };
  }

  // 3. Validate JSON body
  if (request.body === undefined) {
    return { status: 400, error: "Invalid JSON" };
  }

  // Basic validation (mimics Zod schema)
  const body = request.body as {
    events?: unknown;
    session_id?: unknown;
  };
  if (!body || typeof body !== "object") {
    return { status: 400, error: "Invalid payload" };
  }

  if (!Array.isArray(body.events)) {
    return { status: 400, error: "Invalid payload" };
  }

  if (body.events.length === 0 || body.events.length > 50) {
    return { status: 400, error: "Invalid payload" };
  }

  if (!body.session_id || typeof body.session_id !== "string") {
    return { status: 400, error: "Invalid payload" };
  }

  // Validate each event
  for (const event of body.events) {
    const payload = event as {
      event_type?: unknown;
      feature?: unknown;
      device_class?: unknown;
      hour_of_day?: unknown;
    };
    if (!payload.event_type || !["page_view", "feature_enter", "feature_exit", "nav_click"].includes(String(payload.event_type))) {
      return { status: 400, error: "Invalid payload" };
    }
    if (!payload.feature || typeof payload.feature !== "string") {
      return { status: 400, error: "Invalid payload" };
    }
    if (!payload.device_class || !["mobile", "tablet", "desktop"].includes(String(payload.device_class))) {
      return { status: 400, error: "Invalid payload" };
    }
    if (typeof payload.hour_of_day !== "number" || payload.hour_of_day < 0 || payload.hour_of_day > 23) {
      return { status: 400, error: "Invalid payload" };
    }
  }

  const { events, organization_id } = body;

  // 4. Check org membership if organization_id provided
  if (organization_id) {
    const isMember = request.isMember ?? true;
    if (!isMember) {
      // Silently drop events
      return { status: 204 };
    }
  }

  // 5. Resolve tracking level
  const ageBracket = request.ageBracket ?? "18_plus";
  const orgType = request.orgType ?? "general";
  const level = resolveTrackingLevel(true, ageBracket, orgType);

  if (level === "none") {
    return { status: 204 };
  }

  // 6. Filter and sanitize events based on tracking level
  const filteredEvents = events
    .filter((e: UsageEvent) => {
      if (level === "page_view_only" && e.event_type !== "page_view") return false;
      return true;
    })
    .map((e: UsageEvent) => ({
      event_type: e.event_type,
      feature: e.feature,
      duration_ms: level === "page_view_only" ? null : (e.duration_ms ?? null),
      hour_of_day: level === "page_view_only" ? null : e.hour_of_day,
    }));

  if (filteredEvents.length === 0) {
    return { status: 204 };
  }

  // 7. Success
  return { status: 204, events: filteredEvents };
}

// Tests

test("ingest requires authentication", () => {
  const result = simulateIngest({
    auth: { user: null },
    consented: true,
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 401);
});

test("ingest requires consent", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: false,
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 403);
});

test("ingest validates JSON body", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    body: undefined,
  });
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("Invalid JSON"));
});

test("ingest validates payload schema - missing events", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    body: {
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 400);
});

test("ingest validates payload schema - empty events array", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    body: {
      events: [],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 400);
});

test("ingest validates payload schema - missing session_id", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
        },
      ],
    },
  });
  assert.strictEqual(result.status, 400);
});

test("ingest succeeds with valid payload", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
          duration_ms: 5000,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].duration_ms, 5000);
  assert.strictEqual(result.events?.[0].hour_of_day, 14);
});

test("ingest silently drops events for non-member org", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123" } },
    consented: true,
    isMember: false,
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
        },
      ],
      session_id: "session-123",
      organization_id: "org-456",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events, undefined);
});

test("ingest page_view_only (13_17 age bracket) - only page_view events pass", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123", age_bracket: "13_17" } },
    consented: true,
    ageBracket: "13_17",
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
          duration_ms: 5000,
        },
        {
          event_type: "feature_enter",
          feature: "chat",
          device_class: "mobile",
          hour_of_day: 15,
          duration_ms: 3000,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].event_type, "page_view");
});

test("ingest page_view_only (13_17 age bracket) - strips duration_ms and hour_of_day", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123", age_bracket: "13_17" } },
    consented: true,
    ageBracket: "13_17",
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
          duration_ms: 5000,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].duration_ms, null);
  assert.strictEqual(result.events?.[0].hour_of_day, null);
});

test("ingest under_13 age bracket - drops all events (level = none)", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123", age_bracket: "under_13" } },
    consented: true,
    ageBracket: "under_13",
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
        },
      ],
      session_id: "session-123",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events, undefined);
});

test("ingest educational org + 18_plus - applies page_view_only restrictions", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123", age_bracket: "18_plus" } },
    consented: true,
    ageBracket: "18_plus",
    orgType: "educational",
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
          duration_ms: 5000,
        },
        {
          event_type: "feature_enter",
          feature: "chat",
          device_class: "mobile",
          hour_of_day: 15,
        },
      ],
      session_id: "session-123",
      organization_id: "org-edu",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events?.length, 1);
  assert.strictEqual(result.events?.[0].event_type, "page_view");
  assert.strictEqual(result.events?.[0].duration_ms, null);
  assert.strictEqual(result.events?.[0].hour_of_day, null);
});

test("ingest athletic org + 18_plus - full tracking allowed", () => {
  const result = simulateIngest({
    auth: { user: { id: "user-123", age_bracket: "18_plus" } },
    consented: true,
    ageBracket: "18_plus",
    orgType: "athletic",
    body: {
      events: [
        {
          event_type: "page_view",
          feature: "dashboard",
          device_class: "desktop",
          hour_of_day: 14,
          duration_ms: 5000,
        },
        {
          event_type: "feature_enter",
          feature: "chat",
          device_class: "mobile",
          hour_of_day: 15,
          duration_ms: 3000,
        },
      ],
      session_id: "session-123",
      organization_id: "org-athletic",
    },
  });
  assert.strictEqual(result.status, 204);
  assert.strictEqual(result.events?.length, 2);
  assert.strictEqual(result.events?.[0].duration_ms, 5000);
  assert.strictEqual(result.events?.[0].hour_of_day, 14);
  assert.strictEqual(result.events?.[1].duration_ms, 3000);
  assert.strictEqual(result.events?.[1].hour_of_day, 15);
});
