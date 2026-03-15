import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Feed layout structure", () => {
  it("feed page should NOT have container wrapper (layout handles it)", async () => {
    const fs = await import("fs");
    const feedPage = fs.readFileSync("src/app/[orgSlug]/feed/page.tsx", "utf-8");
    assert.ok(
      !feedPage.includes('className="container mx-auto px-4 py-8 max-w-2xl"'),
      "feed page.tsx should not have container wrapper — layout.tsx handles this",
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

  it("feed layout.tsx exists and has grid structure", async () => {
    const fs = await import("fs");
    const layout = fs.readFileSync("src/app/[orgSlug]/feed/layout.tsx", "utf-8");
    assert.ok(layout.includes("xl:grid-cols-"), "layout should have xl grid columns");
    assert.ok(layout.includes("FeedSidebar"), "layout should render FeedSidebar");
    assert.ok(layout.includes("{children}"), "layout should render children");
  });
});
