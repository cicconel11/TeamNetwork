/**
 * Analytics Schema Validation Tests
 *
 * Tests Zod schemas for usage event payloads, consent updates,
 * and UI profile output validation.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Recreate schemas locally (same as src/lib/schemas/analytics.ts)
// ---------------------------------------------------------------------------

const VALID_FEATURES = [
  "dashboard", "members", "chat", "alumni", "mentorship",
  "workouts", "competition", "events", "announcements",
  "philanthropy", "donations", "expenses", "records",
  "schedules", "forms", "customization", "settings",
  "navigation", "other",
] as const;

const usageEventSchema = z.object({
  event_type: z.enum(["page_view", "feature_enter", "feature_exit", "nav_click"]),
  feature: z.enum(VALID_FEATURES),
  duration_ms: z.number().int().nonnegative().optional(),
  device_class: z.enum(["mobile", "tablet", "desktop"]),
  hour_of_day: z.number().int().min(0).max(23),
});

const usageIngestRequestSchema = z.object({
  events: z.array(usageEventSchema).min(1).max(50),
  session_id: z.string().min(1).max(100),
  organization_id: z.string().uuid().optional(),
});

const consentUpdateSchema = z.object({
  consented: z.boolean(),
});

const dashboardHintsSchema = z.object({
  show_recent_features: z.boolean(),
  suggested_features: z.array(z.string()).max(10),
  preferred_time_label: z.string().max(200),
});

const uiProfileSchema = z.object({
  nav_order: z.array(z.string()).max(30),
  feature_highlights: z.array(z.string()).max(10),
  dashboard_hints: dashboardHintsSchema,
});

// ===========================================================================
// Tests
// ===========================================================================

describe("Analytics Schemas - usageEventSchema", () => {
  it("accepts a valid page_view event", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 14,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });

  it("accepts a feature_exit event with duration", () => {
    const event = {
      event_type: "feature_exit",
      feature: "members",
      duration_ms: 30000,
      device_class: "mobile",
      hour_of_day: 9,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });

  it("accepts nav_click event", () => {
    const event = {
      event_type: "nav_click",
      feature: "chat",
      device_class: "tablet",
      hour_of_day: 0,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });

  it("rejects invalid event_type", () => {
    const event = {
      event_type: "scroll",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects invalid feature name", () => {
    const event = {
      event_type: "page_view",
      feature: "admin_panel",
      device_class: "desktop",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects invalid device_class", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "smartwatch",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects hour_of_day > 23", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 24,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects hour_of_day < 0", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: -1,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects negative duration_ms", () => {
    const event = {
      event_type: "feature_exit",
      feature: "events",
      duration_ms: -100,
      device_class: "desktop",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("rejects non-integer duration_ms", () => {
    const event = {
      event_type: "feature_exit",
      feature: "events",
      duration_ms: 100.5,
      device_class: "desktop",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, false);
  });

  it("accepts duration_ms = 0", () => {
    const event = {
      event_type: "feature_exit",
      feature: "events",
      duration_ms: 0,
      device_class: "desktop",
      hour_of_day: 12,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });

  it("accepts hour_of_day = 0 (midnight UTC)", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 0,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });

  it("accepts hour_of_day = 23", () => {
    const event = {
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 23,
    };
    const result = usageEventSchema.safeParse(event);
    assert.strictEqual(result.success, true);
  });
});

describe("Analytics Schemas - usageIngestRequestSchema", () => {
  const validEvent = {
    event_type: "page_view" as const,
    feature: "dashboard" as const,
    device_class: "desktop" as const,
    hour_of_day: 12,
  };

  it("accepts valid batch with one event", () => {
    const request = {
      events: [validEvent],
      session_id: "sess_abc123",
    };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, true);
  });

  it("accepts batch with organization_id", () => {
    const request = {
      events: [validEvent],
      session_id: "sess_abc123",
      organization_id: "12345678-1234-4234-a234-123456789012",
    };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, true);
  });

  it("accepts batch with max 50 events", () => {
    const events = Array.from({ length: 50 }, () => ({ ...validEvent }));
    const request = { events, session_id: "sess_abc" };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, true);
  });

  it("rejects batch with more than 50 events", () => {
    const events = Array.from({ length: 51 }, () => ({ ...validEvent }));
    const request = { events, session_id: "sess_abc" };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, false);
  });

  it("rejects empty events array", () => {
    const request = { events: [], session_id: "sess_abc" };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, false);
  });

  it("rejects empty session_id", () => {
    const request = { events: [validEvent], session_id: "" };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, false);
  });

  it("rejects invalid organization_id (not UUID)", () => {
    const request = {
      events: [validEvent],
      session_id: "sess_abc",
      organization_id: "not-a-uuid",
    };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, false);
  });

  it("accepts request without organization_id", () => {
    const request = { events: [validEvent], session_id: "sess_abc" };
    const result = usageIngestRequestSchema.safeParse(request);
    assert.strictEqual(result.success, true);
  });
});

describe("Analytics Schemas - consentUpdateSchema", () => {
  it("accepts { consented: true }", () => {
    const result = consentUpdateSchema.safeParse({ consented: true });
    assert.strictEqual(result.success, true);
  });

  it("accepts { consented: false }", () => {
    const result = consentUpdateSchema.safeParse({ consented: false });
    assert.strictEqual(result.success, true);
  });

  it("rejects non-boolean consented", () => {
    const result = consentUpdateSchema.safeParse({ consented: "yes" });
    assert.strictEqual(result.success, false);
  });

  it("rejects missing consented field", () => {
    const result = consentUpdateSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });
});

describe("Analytics Schemas - uiProfileSchema", () => {
  it("accepts valid complete profile", () => {
    const profile = {
      nav_order: ["dashboard", "members", "chat", "events"],
      feature_highlights: ["members", "events", "chat"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: ["mentorship", "workouts"],
        preferred_time_label: "You're most active in the morning",
      },
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, true);
  });

  it("accepts empty arrays in profile", () => {
    const profile = {
      nav_order: [],
      feature_highlights: [],
      dashboard_hints: {
        show_recent_features: false,
        suggested_features: [],
        preferred_time_label: "",
      },
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, true);
  });

  it("rejects nav_order with more than 30 items", () => {
    const profile = {
      nav_order: Array.from({ length: 31 }, (_, i) => `feature_${i}`),
      feature_highlights: [],
      dashboard_hints: {
        show_recent_features: false,
        suggested_features: [],
        preferred_time_label: "",
      },
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, false);
  });

  it("rejects feature_highlights with more than 10 items", () => {
    const profile = {
      nav_order: [],
      feature_highlights: Array.from({ length: 11 }, (_, i) => `feature_${i}`),
      dashboard_hints: {
        show_recent_features: false,
        suggested_features: [],
        preferred_time_label: "",
      },
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, false);
  });

  it("rejects missing dashboard_hints", () => {
    const profile = {
      nav_order: ["dashboard"],
      feature_highlights: ["dashboard"],
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, false);
  });

  it("rejects non-boolean show_recent_features", () => {
    const profile = {
      nav_order: [],
      feature_highlights: [],
      dashboard_hints: {
        show_recent_features: "yes",
        suggested_features: [],
        preferred_time_label: "",
      },
    };
    const result = uiProfileSchema.safeParse(profile);
    assert.strictEqual(result.success, false);
  });
});
