/**
 * Analytics Client Tests
 *
 * Tests for the client-side analytics module including:
 * - Feature name extraction from pathnames
 * - Device class derivation from viewport width
 *
 * Note: These tests recreate functions locally to avoid browser/DOM dependencies.
 */

import { describe, it } from "node:test";
import assert from "node:assert";

// ---------------------------------------------------------------------------
// Recreate VALID_FEATURES locally
// ---------------------------------------------------------------------------
const VALID_FEATURES = [
  "dashboard", "members", "chat", "alumni", "mentorship",
  "workouts", "competition", "events", "announcements",
  "philanthropy", "donations", "expenses", "records",
  "calendar", "forms", "customization", "settings",
  "navigation", "other",
] as const;

type ValidFeature = (typeof VALID_FEATURES)[number];

const FEATURE_SET = new Set<string>(VALID_FEATURES);

// ---------------------------------------------------------------------------
// Recreate extractFeature logic
// ---------------------------------------------------------------------------
function extractFeature(pathname: string): ValidFeature {
  const segments = pathname.replace(/^\//, "").split("/");

  // Org-scoped routes: /<orgSlug>/<feature>/...
  if (segments.length >= 2) {
    const candidate = segments[1];
    if (FEATURE_SET.has(candidate)) return candidate as ValidFeature;
  }

  // Org dashboard (/<orgSlug> with no further segment)
  if (segments.length === 1 && segments[0] !== "" && !["app", "auth", "settings", "privacy", "terms", "api"].includes(segments[0])) {
    return "dashboard";
  }

  // Settings pages
  if (segments.some((s) => s === "settings")) return "settings";

  return "other";
}

// ---------------------------------------------------------------------------
// Recreate getDeviceClass logic
// ---------------------------------------------------------------------------
function getDeviceClass(width: number): "mobile" | "tablet" | "desktop" {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Analytics Client - Feature Extraction", () => {
  describe("org-scoped feature routes", () => {
    it("extracts 'members' from /org-slug/members", () => {
      assert.strictEqual(extractFeature("/my-org/members"), "members");
    });

    it("extracts 'members' from /org-slug/members/123", () => {
      assert.strictEqual(extractFeature("/my-org/members/some-id"), "members");
    });

    it("extracts 'chat' from /org-slug/chat", () => {
      assert.strictEqual(extractFeature("/my-org/chat"), "chat");
    });

    it("extracts 'events' from /org-slug/events", () => {
      assert.strictEqual(extractFeature("/org123/events"), "events");
    });

    it("extracts 'announcements' from /org-slug/announcements", () => {
      assert.strictEqual(extractFeature("/my-team/announcements"), "announcements");
    });

    it("extracts 'forms' from /org-slug/forms/some-form-id", () => {
      assert.strictEqual(extractFeature("/org/forms/abc-123"), "forms");
    });

    it("extracts 'calendar' from /org-slug/calendar", () => {
      assert.strictEqual(extractFeature("/team/calendar"), "calendar");
    });

    it("extracts 'donations' from /org-slug/donations", () => {
      assert.strictEqual(extractFeature("/org/donations"), "donations");
    });

    it("extracts 'customization' from /org-slug/customization", () => {
      assert.strictEqual(extractFeature("/org/customization"), "customization");
    });

    it("extracts 'competition' from /org-slug/competition", () => {
      assert.strictEqual(extractFeature("/org/competition"), "competition");
    });

    it("extracts 'workouts' from /org-slug/workouts", () => {
      assert.strictEqual(extractFeature("/org/workouts"), "workouts");
    });

    it("extracts 'alumni' from /org-slug/alumni", () => {
      assert.strictEqual(extractFeature("/org/alumni"), "alumni");
    });

    it("extracts 'mentorship' from /org-slug/mentorship", () => {
      assert.strictEqual(extractFeature("/org/mentorship"), "mentorship");
    });

    it("extracts 'philanthropy' from /org-slug/philanthropy", () => {
      assert.strictEqual(extractFeature("/org/philanthropy"), "philanthropy");
    });

    it("extracts 'expenses' from /org-slug/expenses", () => {
      assert.strictEqual(extractFeature("/org/expenses"), "expenses");
    });

    it("extracts 'records' from /org-slug/records", () => {
      assert.strictEqual(extractFeature("/org/records"), "records");
    });
  });

  describe("dashboard detection", () => {
    it("extracts 'dashboard' from /org-slug (org root)", () => {
      assert.strictEqual(extractFeature("/my-org"), "dashboard");
    });

    it("extracts 'dashboard' from /some-team-slug", () => {
      assert.strictEqual(extractFeature("/some-team-slug"), "dashboard");
    });
  });

  describe("non-org routes", () => {
    it("returns 'other' for /app", () => {
      assert.strictEqual(extractFeature("/app"), "other");
    });

    it("returns 'other' for /auth/login", () => {
      assert.strictEqual(extractFeature("/auth/login"), "other");
    });

    it("returns 'other' for /privacy", () => {
      assert.strictEqual(extractFeature("/privacy"), "other");
    });

    it("returns 'other' for /terms", () => {
      assert.strictEqual(extractFeature("/terms"), "other");
    });

    it("returns 'other' for /api/anything", () => {
      assert.strictEqual(extractFeature("/api/analytics/ingest"), "other");
    });
  });

  describe("settings routes", () => {
    it("extracts 'settings' from /settings/notifications", () => {
      assert.strictEqual(extractFeature("/settings/notifications"), "settings");
    });

    it("extracts 'settings' from /org/settings/invites", () => {
      assert.strictEqual(extractFeature("/org/settings/invites"), "settings");
    });
  });

  describe("unknown feature routes", () => {
    it("returns 'other' for /org-slug/unknown-feature", () => {
      assert.strictEqual(extractFeature("/org/nonexistent-page"), "other");
    });

    it("returns 'other' for root path /", () => {
      assert.strictEqual(extractFeature("/"), "other");
    });
  });

  describe("does NOT leak raw paths or IDs", () => {
    it("normalizes member detail pages to 'members'", () => {
      const result = extractFeature("/org/members/user-uuid-123-456");
      assert.strictEqual(result, "members");
      assert.notStrictEqual(result, "user-uuid-123-456");
    });

    it("normalizes form detail pages to 'forms'", () => {
      const result = extractFeature("/org/forms/form-uuid/submissions");
      assert.strictEqual(result, "forms");
    });
  });
});

describe("Analytics Client - Device Class", () => {
  it("classifies width < 768 as mobile", () => {
    assert.strictEqual(getDeviceClass(375), "mobile");
    assert.strictEqual(getDeviceClass(767), "mobile");
    assert.strictEqual(getDeviceClass(0), "mobile");
  });

  it("classifies 768 <= width < 1024 as tablet", () => {
    assert.strictEqual(getDeviceClass(768), "tablet");
    assert.strictEqual(getDeviceClass(800), "tablet");
    assert.strictEqual(getDeviceClass(1023), "tablet");
  });

  it("classifies width >= 1024 as desktop", () => {
    assert.strictEqual(getDeviceClass(1024), "desktop");
    assert.strictEqual(getDeviceClass(1440), "desktop");
    assert.strictEqual(getDeviceClass(1920), "desktop");
  });
});

// ===========================================================================
// NEW TEST SECTIONS
// ===========================================================================

// ---------------------------------------------------------------------------
// Module state simulation
// ---------------------------------------------------------------------------

type TrackingLevel = "none" | "page_view_only" | "full";
type AgeBracket = "under_13" | "13_17" | "18_plus";
type OrgType = "K12" | "college" | "club_team";

interface TestEvent {
  event_type: string;
  feature: string;
  duration_ms?: number;
  device_class: string;
  hour_of_day: number;
  _organization_id?: string;
}

let eventQueue: TestEvent[] = [];
let trackingLevel: TrackingLevel = "none";
let currentOrgId: string | undefined;
let currentFeature: string | undefined;
let featureEnterTime: number | undefined;
let consecutiveFailures = 0;
let lastConsented = false;
let lastAgeBracket: AgeBracket | null = null;
let flushSucceeds = true;

const MAX_QUEUE_SIZE = 200;
const MAX_CONSECUTIVE_FAILURES = 5;

function resetState() {
  eventQueue = [];
  trackingLevel = "none";
  currentOrgId = undefined;
  currentFeature = undefined;
  featureEnterTime = undefined;
  consecutiveFailures = 0;
  lastConsented = false;
  lastAgeBracket = null;
  flushSucceeds = true;
}

// ---------------------------------------------------------------------------
// Simulate resolveTrackingLevel logic
// ---------------------------------------------------------------------------
function resolveTrackingLevel(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): TrackingLevel {
  if (!consented) return "none";
  if (ageBracket === "under_13") return "none";
  if (ageBracket === "13_17" && orgType === "K12") return "page_view_only";
  return "full";
}

// ---------------------------------------------------------------------------
// Simulate setAnalyticsContext
// ---------------------------------------------------------------------------
function setAnalyticsContext(
  consented: boolean,
  ageBracket: AgeBracket | null | undefined,
  orgType: OrgType | null | undefined,
): void {
  lastConsented = consented;
  lastAgeBracket = ageBracket ?? null;

  const newLevel = resolveTrackingLevel(consented, ageBracket, orgType);

  // If tracking is being disabled, purge queued events and feature timers
  if (newLevel === "none" && trackingLevel !== "none") {
    eventQueue = [];
    currentFeature = undefined;
    featureEnterTime = undefined;
  }

  trackingLevel = newLevel;

  // Reset failure counter when tracking is (re-)enabled
  if (newLevel !== "none") {
    consecutiveFailures = 0;
  }
}

// ---------------------------------------------------------------------------
// Simulate getLastConsentState
// ---------------------------------------------------------------------------
function getLastConsentState(): { consented: boolean; ageBracket: AgeBracket | null } {
  return { consented: lastConsented, ageBracket: lastAgeBracket };
}

// ---------------------------------------------------------------------------
// Simulate captureEvent
// ---------------------------------------------------------------------------
function captureEvent(event: TestEvent): void {
  if (trackingLevel === "none") return;

  // Apply restrictions for page_view_only level
  const sanitized: TestEvent = { ...event };
  if (trackingLevel === "page_view_only") {
    delete sanitized.duration_ms;
    sanitized.hour_of_day = 0; // zero out
    // Only allow page_view events
    if (sanitized.event_type !== "page_view") return;
  }

  sanitized._organization_id = currentOrgId;
  eventQueue.push(sanitized);

  if (eventQueue.length > MAX_QUEUE_SIZE) {
    eventQueue = eventQueue.slice(-MAX_QUEUE_SIZE);
  }
}

// ---------------------------------------------------------------------------
// Simulate handleRouteChange
// ---------------------------------------------------------------------------
function handleRouteChange(pathname: string): void {
  if (trackingLevel === "none") return;

  const feature = extractFeature(pathname);

  // Exit previous feature
  if (currentFeature && featureEnterTime) {
    const duration = Date.now() - featureEnterTime;
    captureEvent({
      event_type: "feature_exit",
      feature: currentFeature,
      duration_ms: duration,
      device_class: "desktop",
      hour_of_day: new Date().getUTCHours(),
    });
  }

  // Enter new feature
  currentFeature = feature;
  featureEnterTime = Date.now();

  captureEvent({
    event_type: "page_view",
    feature,
    device_class: "desktop",
    hour_of_day: new Date().getUTCHours(),
  });

  captureEvent({
    event_type: "feature_enter",
    feature,
    device_class: "desktop",
    hour_of_day: new Date().getUTCHours(),
  });
}

// ---------------------------------------------------------------------------
// Simulate flush logic for retry tests
// ---------------------------------------------------------------------------

function simulateFlush(): boolean {
  if (flushSucceeds) {
    consecutiveFailures = 0;
    return true;
  } else {
    consecutiveFailures++;
    return false;
  }
}

function scheduleFlush(): boolean {
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return false;
  return true;
}

// ===========================================================================
// NEW TEST SECTIONS
// ===========================================================================

describe("Analytics Client - resolveTrackingLevel Integration with captureEvent", () => {
  it("when level is 'none', captureEvent does not queue events", () => {
    resetState();
    setAnalyticsContext(false, "18_plus", "college");
    assert.strictEqual(trackingLevel, "none");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 0);
  });

  it("when level is 'page_view_only', only page_view events are queued", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0].event_type, "page_view");
  });

  it("when level is 'page_view_only', feature_enter events are dropped", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "feature_enter",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 0);
  });

  it("when level is 'page_view_only', feature_exit events are dropped", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "feature_exit",
      feature: "members",
      duration_ms: 5000,
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 0);
  });

  it("when level is 'page_view_only', nav_click events are dropped", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "nav_click",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 0);
  });

  it("when level is 'page_view_only', duration_ms is stripped from page_view events", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      duration_ms: 5000,
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0].duration_ms, undefined);
  });

  it("when level is 'page_view_only', hour_of_day is set to 0", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");
    assert.strictEqual(trackingLevel, "page_view_only");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 15,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0].hour_of_day, 0);
  });

  it("when level is 'full', all event types are queued", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");
    assert.strictEqual(trackingLevel, "full");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    captureEvent({
      event_type: "feature_enter",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    captureEvent({
      event_type: "feature_exit",
      feature: "members",
      duration_ms: 5000,
      device_class: "desktop",
      hour_of_day: 12,
    });

    captureEvent({
      event_type: "nav_click",
      feature: "chat",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 4);
    assert.strictEqual(eventQueue[0].event_type, "page_view");
    assert.strictEqual(eventQueue[1].event_type, "feature_enter");
    assert.strictEqual(eventQueue[2].event_type, "feature_exit");
    assert.strictEqual(eventQueue[3].event_type, "nav_click");
  });

  it("when level is 'full', duration_ms and hour_of_day are preserved", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");
    assert.strictEqual(trackingLevel, "full");

    captureEvent({
      event_type: "feature_exit",
      feature: "members",
      duration_ms: 7500,
      device_class: "desktop",
      hour_of_day: 18,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0].duration_ms, 7500);
    assert.strictEqual(eventQueue[0].hour_of_day, 18);
  });
});

describe("Analytics Client - setAnalyticsContext Behavior", () => {
  it("switching to 'none' purges the event queue", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 1);

    setAnalyticsContext(false, "18_plus", "college");
    assert.strictEqual(trackingLevel, "none");
    assert.strictEqual(eventQueue.length, 0);
  });

  it("switching to 'none' clears feature timers", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    currentFeature = "members";
    featureEnterTime = Date.now();

    assert.ok(currentFeature);
    assert.ok(featureEnterTime);

    setAnalyticsContext(false, "18_plus", "college");

    assert.strictEqual(currentFeature, undefined);
    assert.strictEqual(featureEnterTime, undefined);
  });

  it("re-enabling tracking resets consecutiveFailures counter", () => {
    resetState();
    consecutiveFailures = 3;

    setAnalyticsContext(true, "18_plus", "college");
    assert.strictEqual(trackingLevel, "full");
    assert.strictEqual(consecutiveFailures, 0);
  });

  it("getLastConsentState returns values passed to setAnalyticsContext", () => {
    resetState();
    setAnalyticsContext(true, "13_17", "K12");

    const state = getLastConsentState();
    assert.strictEqual(state.consented, true);
    assert.strictEqual(state.ageBracket, "13_17");
  });

  it("getLastConsentState returns false after disabling tracking", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");
    setAnalyticsContext(false, "18_plus", "college");

    const state = getLastConsentState();
    assert.strictEqual(state.consented, false);
  });

  it("getLastConsentState handles null ageBracket", () => {
    resetState();
    setAnalyticsContext(true, null, "club_team");

    const state = getLastConsentState();
    assert.strictEqual(state.consented, true);
    assert.strictEqual(state.ageBracket, null);
  });
});

describe("Analytics Client - handleRouteChange Behavior", () => {
  it("handleRouteChange emits page_view event", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    handleRouteChange("/org/members");

    const pageViewEvents = eventQueue.filter((e) => e.event_type === "page_view");
    assert.strictEqual(pageViewEvents.length, 1);
    assert.strictEqual(pageViewEvents[0].feature, "members");
  });

  it("handleRouteChange emits feature_enter event", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    handleRouteChange("/org/members");

    const enterEvents = eventQueue.filter((e) => e.event_type === "feature_enter");
    assert.strictEqual(enterEvents.length, 1);
    assert.strictEqual(enterEvents[0].feature, "members");
  });

  it("handleRouteChange emits feature_exit for previous feature", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    handleRouteChange("/org/members");
    eventQueue = []; // Clear initial events

    handleRouteChange("/org/chat");

    const exitEvents = eventQueue.filter((e) => e.event_type === "feature_exit");
    assert.strictEqual(exitEvents.length, 1);
    assert.strictEqual(exitEvents[0].feature, "members");
  });

  it("feature timer tracks duration correctly", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    handleRouteChange("/org/members");
    const enterTime = Date.now();
    featureEnterTime = enterTime;

    // Simulate 1 second passage
    const exitTime = enterTime + 1000;
    const originalNow = Date.now;
    Date.now = () => exitTime;

    eventQueue = []; // Clear initial events
    handleRouteChange("/org/chat");

    Date.now = originalNow;

    const exitEvents = eventQueue.filter((e) => e.event_type === "feature_exit");
    assert.strictEqual(exitEvents.length, 1);
    assert.ok(exitEvents[0].duration_ms);
    assert.ok(exitEvents[0].duration_ms >= 1000);
  });

  it("handleRouteChange does nothing when tracking is disabled", () => {
    resetState();
    setAnalyticsContext(false, "18_plus", "college");

    handleRouteChange("/org/members");

    assert.strictEqual(eventQueue.length, 0);
  });

  it("handleRouteChange updates currentFeature", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    handleRouteChange("/org/members");
    assert.strictEqual(currentFeature, "members");

    handleRouteChange("/org/chat");
    assert.strictEqual(currentFeature, "chat");
  });
});

describe("Analytics Client - consecutiveFailures (flush retry limit)", () => {
  it("after 5 consecutive failures, scheduleFlush stops scheduling", () => {
    resetState();
    flushSucceeds = false;

    for (let i = 0; i < 5; i++) {
      const canSchedule = scheduleFlush();
      assert.ok(canSchedule, `Should schedule on attempt ${i + 1}`);
      simulateFlush();
    }

    assert.strictEqual(consecutiveFailures, 5);
    const canSchedule = scheduleFlush();
    assert.strictEqual(canSchedule, false);
  });

  it("a successful flush resets consecutiveFailures to 0", () => {
    resetState();
    flushSucceeds = false;

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      simulateFlush();
    }
    assert.strictEqual(consecutiveFailures, 3);

    // Succeed once
    flushSucceeds = true;
    simulateFlush();
    assert.strictEqual(consecutiveFailures, 0);
  });

  it("setAnalyticsContext with tracking re-enabled resets consecutiveFailures", () => {
    resetState();
    consecutiveFailures = 4;

    setAnalyticsContext(true, "18_plus", "college");
    assert.strictEqual(consecutiveFailures, 0);
  });

  it("consecutiveFailures does not reset when setting tracking to 'none'", () => {
    resetState();
    consecutiveFailures = 3;

    setAnalyticsContext(false, "18_plus", "college");
    assert.strictEqual(trackingLevel, "none");
    assert.strictEqual(consecutiveFailures, 3);
  });

  it("scheduleFlush allows scheduling below the failure threshold", () => {
    resetState();
    consecutiveFailures = 4;

    const canSchedule = scheduleFlush();
    assert.strictEqual(canSchedule, true);
  });

  it("scheduleFlush blocks scheduling at the failure threshold", () => {
    resetState();
    consecutiveFailures = 5;

    const canSchedule = scheduleFlush();
    assert.strictEqual(canSchedule, false);
  });
});

describe("Analytics Client - captureEvent Queue Management", () => {
  it("queue respects MAX_QUEUE_SIZE (200): excess events trimmed from front", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    // Add 250 events
    for (let i = 0; i < 250; i++) {
      captureEvent({
        event_type: "page_view",
        feature: `feature_${i}`,
        device_class: "desktop",
        hour_of_day: 12,
      });
    }

    assert.strictEqual(eventQueue.length, MAX_QUEUE_SIZE);
    // First 50 events should be trimmed, so queue starts at feature_50
    assert.strictEqual(eventQueue[0].feature, "feature_50");
    assert.strictEqual(eventQueue[eventQueue.length - 1].feature, "feature_249");
  });

  it("events get _organization_id stamped from currentOrgId", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");
    currentOrgId = "org-123";

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0]._organization_id, "org-123");
  });

  it("events get undefined _organization_id when currentOrgId is undefined", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");
    currentOrgId = undefined;

    captureEvent({
      event_type: "page_view",
      feature: "members",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(eventQueue.length, 1);
    assert.strictEqual(eventQueue[0]._organization_id, undefined);
  });

  it("queue trimming preserves most recent events", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    // Add events with recognizable features
    for (let i = 0; i < 50; i++) {
      captureEvent({
        event_type: "page_view",
        feature: "old",
        device_class: "desktop",
        hour_of_day: 12,
      });
    }

    for (let i = 0; i < 200; i++) {
      captureEvent({
        event_type: "page_view",
        feature: "recent",
        device_class: "desktop",
        hour_of_day: 12,
      });
    }

    assert.strictEqual(eventQueue.length, MAX_QUEUE_SIZE);
    // All "old" events should be trimmed
    const hasOld = eventQueue.some((e) => e.feature === "old");
    assert.strictEqual(hasOld, false);
    // All events should be "recent"
    const allRecent = eventQueue.every((e) => e.feature === "recent");
    assert.ok(allRecent);
  });

  it("queue does not trim when below MAX_QUEUE_SIZE", () => {
    resetState();
    setAnalyticsContext(true, "18_plus", "college");

    for (let i = 0; i < 100; i++) {
      captureEvent({
        event_type: "page_view",
        feature: `feature_${i}`,
        device_class: "desktop",
        hour_of_day: 12,
      });
    }

    assert.strictEqual(eventQueue.length, 100);
    assert.strictEqual(eventQueue[0].feature, "feature_0");
    assert.strictEqual(eventQueue[99].feature, "feature_99");
  });
});
