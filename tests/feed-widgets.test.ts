import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Feed widget components", () => {
  it("UpcomingEventsWidget exists and accepts expected props", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/UpcomingEventsWidget.tsx", "utf-8");
    assert.ok(code.includes("orgSlug"), "should accept orgSlug prop");
    assert.ok(code.includes("Card interactive"), "should use interactive Card component");
    assert.ok(code.includes("See all events"), "should have 'See all' link");
    assert.ok(code.includes("stagger-children"), "should use stagger animation");
  });

  it("RecentAnnouncementsWidget exists and accepts expected props", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/RecentAnnouncementsWidget.tsx", "utf-8");
    assert.ok(code.includes("orgSlug"), "should accept orgSlug prop");
    assert.ok(code.includes("Card interactive"), "should use interactive Card");
    assert.ok(code.includes("stagger-children"), "should use stagger animation");
  });

  it("MemberHighlightsWidget exists and accepts expected props", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/MemberHighlightsWidget.tsx", "utf-8");
    assert.ok(code.includes("orgSlug"), "should accept orgSlug prop");
    assert.ok(code.includes("Card interactive"), "should use interactive Card");
    assert.ok(code.includes("photo_url"), "should render member avatar");
    assert.ok(code.includes("isRecent"), "should track recent join status for green dot");
  });

  it("FeedSidebar renders all three widgets", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedSidebar.tsx", "utf-8");
    assert.ok(code.includes("UpcomingEventsWidget"), "should render events widget");
    assert.ok(code.includes("RecentAnnouncementsWidget"), "should render announcements widget");
    assert.ok(code.includes("MemberHighlightsWidget"), "should render member highlights widget");
  });
});
