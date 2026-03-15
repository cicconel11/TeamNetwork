import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Feed layout structure", () => {
  it("feed page.tsx redirects to org home", async () => {
    const fs = await import("fs");
    const feedPage = fs.readFileSync("src/app/[orgSlug]/feed/page.tsx", "utf-8");
    assert.ok(
      feedPage.includes("redirect("),
      "feed page.tsx should redirect to org home",
    );
  });

  it("post detail page should NOT have container wrapper", async () => {
    const fs = await import("fs");
    const detailPage = fs.readFileSync("src/app/[orgSlug]/feed/[postId]/page.tsx", "utf-8");
    assert.ok(
      !detailPage.includes('className="container mx-auto px-4 py-8 max-w-2xl"'),
      "post detail page should not have container wrapper — layout.tsx handles this",
    );
  });

  it("feed layout.tsx is a pass-through", async () => {
    const fs = await import("fs");
    const layout = fs.readFileSync("src/app/[orgSlug]/feed/layout.tsx", "utf-8");
    assert.ok(layout.includes("{children}"), "layout should render children");
  });

  it("org home page has feed grid structure with sidebar", async () => {
    const fs = await import("fs");
    const homePage = fs.readFileSync("src/app/[orgSlug]/page.tsx", "utf-8");
    assert.ok(homePage.includes("xl:grid-cols-"), "home page should have xl grid columns");
    assert.ok(homePage.includes("FeedSidebar"), "home page should render FeedSidebar");
    assert.ok(homePage.includes("FeedComposer"), "home page should render FeedComposer");
    assert.ok(homePage.includes("FeedList"), "home page should render FeedList");
    assert.ok(homePage.includes("CompactStatsWidget"), "home page should render CompactStatsWidget");
  });
});
