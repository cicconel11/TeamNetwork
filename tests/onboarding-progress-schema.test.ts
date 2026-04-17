import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  onboardingItemIdSchema,
  markItemCompleteSchema,
  dismissChecklistSchema,
  markVisitedSchema,
  markWelcomeSeenSchema,
  markTourCompletedSchema,
  onboardingProgressRowSchema,
  ONBOARDING_ITEM_IDS,
} from "@/lib/schemas/onboarding";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("onboardingItemIdSchema", () => {
  it("accepts all valid item IDs", () => {
    for (const id of ONBOARDING_ITEM_IDS) {
      const result = onboardingItemIdSchema.safeParse(id);
      assert.equal(result.success, true, `Should accept ${id}`);
    }
  });

  it("rejects unknown item ID", () => {
    const result = onboardingItemIdSchema.safeParse("nonexistent_item");
    assert.equal(result.success, false);
  });

  it("rejects empty string", () => {
    const result = onboardingItemIdSchema.safeParse("");
    assert.equal(result.success, false);
  });
});

describe("markItemCompleteSchema", () => {
  it("accepts valid payload", () => {
    const result = markItemCompleteSchema.safeParse({
      orgId: VALID_UUID,
      itemId: "post_feed",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.itemId, "post_feed");
    }
  });

  it("rejects invalid orgId (not uuid)", () => {
    const result = markItemCompleteSchema.safeParse({
      orgId: "not-a-uuid",
      itemId: "post_feed",
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid itemId", () => {
    const result = markItemCompleteSchema.safeParse({
      orgId: VALID_UUID,
      itemId: "hack_the_planet",
    });
    assert.equal(result.success, false);
  });
});

describe("dismissChecklistSchema", () => {
  it("accepts valid payload", () => {
    const result = dismissChecklistSchema.safeParse({ orgId: VALID_UUID });
    assert.equal(result.success, true);
  });

  it("rejects missing orgId", () => {
    const result = dismissChecklistSchema.safeParse({});
    assert.equal(result.success, false);
  });
});

describe("markVisitedSchema", () => {
  it("accepts valid payload", () => {
    const result = markVisitedSchema.safeParse({ orgId: VALID_UUID, itemId: "rsvp_event" });
    assert.equal(result.success, true);
  });
});

describe("markWelcomeSeenSchema", () => {
  it("accepts valid payload", () => {
    const result = markWelcomeSeenSchema.safeParse({ orgId: VALID_UUID });
    assert.equal(result.success, true);
  });
});

describe("markTourCompletedSchema", () => {
  it("accepts valid payload", () => {
    const result = markTourCompletedSchema.safeParse({ orgId: VALID_UUID });
    assert.equal(result.success, true);
  });
});

describe("onboardingProgressRowSchema", () => {
  const validRow = {
    id: VALID_UUID,
    user_id: VALID_UUID,
    organization_id: VALID_UUID,
    completed_items: ["post_feed", "rsvp_event"],
    visited_items: ["read_announcement"],
    welcome_seen_at: "2026-04-01T12:00:00.000Z",
    tour_completed_at: null,
    dismissed_at: null,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
  };

  it("accepts a valid progress row", () => {
    const result = onboardingProgressRowSchema.safeParse(validRow);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.completed_items.length, 2);
      assert.equal(result.data.dismissed_at, null);
    }
  });

  it("rejects row with invalid completed item", () => {
    const result = onboardingProgressRowSchema.safeParse({
      ...validRow,
      completed_items: ["invalid_item_xyz"],
    });
    assert.equal(result.success, false);
  });

  it("accepts row with empty arrays", () => {
    const result = onboardingProgressRowSchema.safeParse({
      ...validRow,
      completed_items: [],
      visited_items: [],
    });
    assert.equal(result.success, true);
  });

  it("accepts row with dismissed_at timestamp", () => {
    const result = onboardingProgressRowSchema.safeParse({
      ...validRow,
      dismissed_at: "2026-04-02T09:00:00.000Z",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.ok(result.data.dismissed_at !== null);
    }
  });
});
