import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recurrenceRuleSchema,
  newEventSchema,
  editScopeSchema,
  deleteScopeSchema,
} from "@/lib/schemas/content";

describe("recurrenceRuleSchema", () => {
  it("accepts valid daily rule", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "daily",
      recurrence_end_date: "2026-06-01",
    });
    assert.ok(result.success);
  });

  it("accepts daily without end date", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "daily",
    });
    assert.ok(result.success);
  });

  it("accepts valid weekly rule with day_of_week", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "weekly",
      day_of_week: ["1", "3"],
      recurrence_end_date: "2026-06-01",
    });
    assert.ok(result.success);
  });

  it("rejects weekly without day_of_week", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "weekly",
    });
    assert.ok(!result.success);
  });

  it("accepts valid monthly rule with day_of_month", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "monthly",
      day_of_month: "15",
      recurrence_end_date: "2026-12-31",
    });
    assert.ok(result.success);
  });

  it("rejects monthly without day_of_month", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "monthly",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid occurrence_type", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "biweekly",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid day_of_week values", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "weekly",
      day_of_week: ["7"], // out of range
    });
    assert.ok(!result.success);
  });

  it("rejects invalid day_of_month", () => {
    const result = recurrenceRuleSchema.safeParse({
      occurrence_type: "monthly",
      day_of_month: "32",
    });
    assert.ok(!result.success);
  });
});

describe("newEventSchema recurrence validation", () => {
  const baseEvent = {
    title: "Team Practice",
    start_date: "2026-03-09",
    start_time: "18:00",
    event_type: "general",
    is_philanthropy: false,
    audience: "both",
    send_notification: true,
    channel: "email",
    is_recurring: false,
  };

  it("accepts non-recurring event without recurrence field", () => {
    const result = newEventSchema.safeParse(baseEvent);
    assert.ok(result.success, JSON.stringify(result));
  });

  it("rejects recurring event without recurrence rule", () => {
    const result = newEventSchema.safeParse({
      ...baseEvent,
      is_recurring: true,
    });
    assert.ok(!result.success);
  });

  it("accepts recurring event with valid recurrence rule", () => {
    const result = newEventSchema.safeParse({
      ...baseEvent,
      is_recurring: true,
      recurrence: {
        occurrence_type: "weekly",
        day_of_week: ["1"],
        recurrence_end_date: "2026-06-01",
      },
    });
    assert.ok(result.success, JSON.stringify(result));
  });
});

describe("editScopeSchema", () => {
  it("accepts this_only", () => {
    assert.ok(editScopeSchema.safeParse("this_only").success);
  });

  it("accepts this_and_future", () => {
    assert.ok(editScopeSchema.safeParse("this_and_future").success);
  });

  it("rejects invalid scope", () => {
    assert.ok(!editScopeSchema.safeParse("all").success);
  });
});

describe("deleteScopeSchema", () => {
  it("accepts all three scopes", () => {
    assert.ok(deleteScopeSchema.safeParse("this_only").success);
    assert.ok(deleteScopeSchema.safeParse("this_and_future").success);
    assert.ok(deleteScopeSchema.safeParse("all_in_series").success);
  });

  it("rejects invalid scope", () => {
    assert.ok(!deleteScopeSchema.safeParse("none").success);
  });
});
