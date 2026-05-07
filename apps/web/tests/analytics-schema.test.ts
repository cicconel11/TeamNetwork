import { describe, it } from "node:test";
import assert from "node:assert";
import {
  analyticsEventSchema,
  analyticsOpsEventSchema,
  consentUpdateSchema,
  uiProfileSchema,
  usageEventSchema,
  usageIngestRequestSchema,
} from "@/lib/schemas/analytics";

const analyticsCommonFields = {
  org_id: "12345678-1234-4234-a234-123456789012",
  session_id: "sess_abc123",
  client_day: "2026-03-18",
  platform: "web" as const,
  device_class: "desktop" as const,
  app_version: "1.2.3",
  route: "/org/chat",
  referrer_type: "direct" as const,
  consent_state: "opted_in" as const,
};

describe("Analytics Schemas - usageEventSchema", () => {
  it("accepts a valid page_view event", () => {
    const result = usageEventSchema.safeParse({
      event_type: "page_view",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 14,
    });

    assert.strictEqual(result.success, true);
  });

  it("rejects invalid event_type", () => {
    const result = usageEventSchema.safeParse({
      event_type: "scroll",
      feature: "dashboard",
      device_class: "desktop",
      hour_of_day: 12,
    });

    assert.strictEqual(result.success, false);
  });

  it("rejects hour_of_day outside the 0-23 range", () => {
    assert.strictEqual(
      usageEventSchema.safeParse({
        event_type: "page_view",
        feature: "dashboard",
        device_class: "desktop",
        hour_of_day: -1,
      }).success,
      false,
    );
    assert.strictEqual(
      usageEventSchema.safeParse({
        event_type: "page_view",
        feature: "dashboard",
        device_class: "desktop",
        hour_of_day: 24,
      }).success,
      false,
    );
  });
});

describe("Analytics Schemas - usageIngestRequestSchema", () => {
  const validEvent = {
    event_type: "page_view" as const,
    feature: "dashboard" as const,
    device_class: "desktop" as const,
    hour_of_day: 12,
  };

  it("accepts a valid batch", () => {
    const result = usageIngestRequestSchema.safeParse({
      events: [validEvent],
      session_id: "sess_abc123",
    });

    assert.strictEqual(result.success, true);
  });

  it("rejects empty batches", () => {
    const result = usageIngestRequestSchema.safeParse({
      events: [],
      session_id: "sess_abc123",
    });

    assert.strictEqual(result.success, false);
  });

  it("rejects invalid organization IDs", () => {
    const result = usageIngestRequestSchema.safeParse({
      events: [validEvent],
      session_id: "sess_abc123",
      organization_id: "not-a-uuid",
    });

    assert.strictEqual(result.success, false);
  });
});

describe("Analytics Schemas - consentUpdateSchema", () => {
  it("accepts boolean consent updates", () => {
    assert.strictEqual(consentUpdateSchema.safeParse({ consented: true }).success, true);
    assert.strictEqual(consentUpdateSchema.safeParse({ consented: false }).success, true);
  });

  it("rejects non-boolean consent values", () => {
    assert.strictEqual(consentUpdateSchema.safeParse({ consented: "yes" }).success, false);
  });
});

describe("Analytics Schemas - live analyticsEventSchema", () => {
  it("accepts chat analytics payloads for text, poll, and form message types", () => {
    for (const messageType of ["text", "poll", "form"] as const) {
      const result = analyticsEventSchema.safeParse({
        event_name: "chat_message_send",
        payload: {
          ...analyticsCommonFields,
          thread_id: "thread-123",
          message_type: messageType,
          result: "success",
        },
      });

      assert.strictEqual(result.success, true);
    }
  });

  it("rejects stale or free-form chat message types", () => {
    for (const messageType of ["image", "file", "meet Alice after practice"]) {
      const result = analyticsEventSchema.safeParse({
        event_name: "chat_message_send",
        payload: {
          ...analyticsCommonFields,
          thread_id: "thread-123",
          message_type: messageType,
          result: "success",
        },
      });

      assert.strictEqual(result.success, false);
    }
  });

  it("accepts parents as a supported directory type", () => {
    const result = analyticsEventSchema.safeParse({
      event_name: "directory_view",
      payload: {
        ...analyticsCommonFields,
        directory_type: "parents",
      },
    });

    assert.strictEqual(result.success, true);
  });

  it("rejects unsupported directory types", () => {
    const result = analyticsEventSchema.safeParse({
      event_name: "directory_view",
      payload: {
        ...analyticsCommonFields,
        directory_type: "jobs",
      },
    });

    assert.strictEqual(result.success, false);
  });
});

describe("Analytics Schemas - live analyticsOpsEventSchema", () => {
  it("accepts client_error payloads emitted by the client tracker", () => {
    const result = analyticsOpsEventSchema.safeParse({
      event_name: "client_error",
      payload: {
        ...analyticsCommonFields,
        error_code: "consent_query_failed",
      },
    });

    assert.strictEqual(result.success, true);
  });

  it("accepts api_error payloads with endpoint metadata", () => {
    const result = analyticsOpsEventSchema.safeParse({
      event_name: "api_error",
      payload: {
        ...analyticsCommonFields,
        endpoint_group: "schedule",
        http_status: 503,
        error_code: "network_error",
        retryable: true,
      },
    });

    assert.strictEqual(result.success, true);
  });

  it("accepts api_error payloads for network failures without an HTTP response", () => {
    const result = analyticsOpsEventSchema.safeParse({
      event_name: "api_error",
      payload: {
        ...analyticsCommonFields,
        endpoint_group: "schedule",
        http_status: 0,
        error_code: "network_error",
        retryable: true,
      },
    });

    assert.strictEqual(result.success, true);
  });
});

describe("Analytics Schemas - uiProfileSchema", () => {
  it("accepts valid complete profile", () => {
    const result = uiProfileSchema.safeParse({
      nav_order: ["dashboard", "members", "chat", "events"],
      feature_highlights: ["members", "events", "chat"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: ["mentorship", "workouts"],
        preferred_time_label: "You're most active in the morning",
      },
    });

    assert.strictEqual(result.success, true);
  });

  it("rejects too many suggested features", () => {
    const result = uiProfileSchema.safeParse({
      nav_order: ["dashboard"],
      feature_highlights: ["members"],
      dashboard_hints: {
        show_recent_features: true,
        suggested_features: Array.from({ length: 11 }, (_, index) => `feature-${index}`),
        preferred_time_label: "Any time",
      },
    });

    assert.strictEqual(result.success, false);
  });
});
