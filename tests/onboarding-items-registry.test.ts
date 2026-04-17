import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getVisibleOnboardingItems } from "@/lib/onboarding/visible-items";
import { ONBOARDING_ITEMS } from "@/lib/onboarding/items";
import { ONBOARDING_ITEM_IDS } from "@/lib/schemas/onboarding";

describe("ONBOARDING_ITEMS registry", () => {
  it("has items with unique IDs", () => {
    const ids = ONBOARDING_ITEMS.map((i) => i.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "All item IDs must be unique");
  });

  it("all items have title, description, href function", () => {
    for (const item of ONBOARDING_ITEMS) {
      assert.ok(item.title.length > 0, `${item.id} must have a title`);
      assert.ok(item.description.length > 0, `${item.id} must have a description`);
      assert.ok(typeof item.href === "function", `${item.id} href must be a function`);
    }
  });

  it("href function produces a URL string", () => {
    for (const item of ONBOARDING_ITEMS) {
      const href = item.href("test-org", "member-123");
      assert.ok(typeof href === "string" && href.length > 0, `${item.id} href must produce a string`);
    }
  });

  it("ONBOARDING_ITEMS ids match ONBOARDING_ITEM_IDS (no drift)", () => {
    const registryIds = ONBOARDING_ITEMS.map((i) => i.id).sort();
    const schemaIds = [...ONBOARDING_ITEM_IDS].sort();
    assert.deepEqual(
      registryIds,
      schemaIds,
      "items.ts registry and schemas/onboarding.ts ONBOARDING_ITEM_IDS must stay in sync"
    );
  });
});

describe("getVisibleOnboardingItems", () => {
  it("returns universal items for active_member", () => {
    const items = getVisibleOnboardingItems({ role: "active_member" });
    const ids = items.map((i) => i.id);

    assert.ok(ids.includes("complete_profile"));
    assert.ok(ids.includes("post_feed"));
    assert.ok(ids.includes("rsvp_event"));
    assert.ok(ids.includes("send_message"));
    assert.ok(ids.includes("read_announcement"));
    assert.ok(ids.includes("configure_notifications"));
  });

  it("includes log_workout for active_member", () => {
    const items = getVisibleOnboardingItems({ role: "active_member" });
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes("log_workout"), "active_member should see log_workout");
  });

  it("excludes alumni-only items when hasAlumniAccess=false", () => {
    const items = getVisibleOnboardingItems({ role: "alumni", hasAlumniAccess: false });
    const ids = items.map((i) => i.id);
    assert.ok(!ids.includes("update_linkedin"), "update_linkedin requires alumni access");
    assert.ok(!ids.includes("browse_alumni_directory"), "browse_alumni_directory requires alumni access");
  });

  it("includes alumni items when hasAlumniAccess=true and role=alumni", () => {
    const items = getVisibleOnboardingItems({ role: "alumni", hasAlumniAccess: true });
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes("update_linkedin"), "alumni with access should see update_linkedin");
    assert.ok(ids.includes("browse_alumni_directory"), "alumni with access should see browse_alumni_directory");
  });

  it("excludes alumni-specific items for active_member even with access", () => {
    const items = getVisibleOnboardingItems({ role: "active_member", hasAlumniAccess: true });
    const ids = items.map((i) => i.id);
    // update_linkedin is alumni role only
    assert.ok(!ids.includes("update_linkedin"), "update_linkedin is alumni role only");
  });

  it("excludes log_workout for alumni role", () => {
    const items = getVisibleOnboardingItems({ role: "alumni", hasAlumniAccess: true });
    const ids = items.map((i) => i.id);
    assert.ok(!ids.includes("log_workout"), "log_workout is not for alumni role");
  });

  it("returns at most 8 items", () => {
    const items = getVisibleOnboardingItems({ role: "admin", hasAlumniAccess: true });
    assert.ok(items.length <= 8, `Should return at most 8 items, got ${items.length}`);
  });

  it("returns items for null role (not yet assigned)", () => {
    const items = getVisibleOnboardingItems({ role: null });
    // With null role, role filter is bypassed so universal + role-scoped items may appear
    // (but alumni-gated items still require hasAlumniAccess, which defaults to false).
    assert.ok(items.length > 0, "Should return at least some items for null role");
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes("complete_profile"), "Universal item complete_profile must appear");
    assert.ok(ids.includes("post_feed"), "Universal item post_feed must appear");
    // Alumni-gated items should NOT appear without hasAlumniAccess
    assert.ok(!ids.includes("update_linkedin"), "update_linkedin requires alumni access");
    assert.ok(!ids.includes("browse_alumni_directory"), "browse_alumni_directory requires alumni access");
  });

  it("returns items for parent role", () => {
    const items = getVisibleOnboardingItems({ role: "parent" });
    const ids = items.map((i) => i.id);
    // Universal items visible
    assert.ok(ids.includes("complete_profile"));
    // log_workout not for parent
    assert.ok(!ids.includes("log_workout"), "parent should not see log_workout");
  });
});
