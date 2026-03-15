import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "fs";

describe("Feed rework integration", () => {
  it("all required files exist", () => {
    const requiredFiles = [
      "src/app/[orgSlug]/feed/layout.tsx",
      "src/components/feed/FeedSidebar.tsx",
      "src/components/feed/UpcomingEventsWidget.tsx",
      "src/components/feed/RecentAnnouncementsWidget.tsx",
      "src/components/feed/MemberHighlightsWidget.tsx",
      "src/components/feed/PostMedia.tsx",
    ];
    for (const file of requiredFiles) {
      assert.ok(existsSync(file), `${file} should exist`);
    }
  });

  it("feed page does not duplicate container wrapper", () => {
    const feedPage = readFileSync("src/app/[orgSlug]/feed/page.tsx", "utf-8");
    const containerCount = (feedPage.match(/container mx-auto/g) || []).length;
    assert.equal(containerCount, 0, "feed page should have no container wrapper");
  });

  it("feed layout has grid structure (no redundant container)", () => {
    const layout = readFileSync("src/app/[orgSlug]/feed/layout.tsx", "utf-8");
    assert.ok(!layout.includes("container mx-auto"), "layout should NOT have container wrapper — org layout handles padding");
    assert.ok(layout.includes("xl:grid-cols-"), "layout should have grid columns");
  });

  it("no database migration was needed", async () => {
    const fs = await import("fs");
    const migrations = fs.readdirSync("supabase/migrations/");
    const feedMigrations = migrations.filter((f: string) => f.includes("feed_posts_image"));
    assert.equal(feedMigrations.length, 0, "should not have created feed_posts_image migration");
  });
});
