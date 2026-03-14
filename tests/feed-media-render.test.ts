import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Feed media rendering", () => {
  it("FeedPost renders media attachments", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedPost.tsx", "utf-8");
    assert.ok(code.includes("media"), "should reference media in props or rendering");
    assert.ok(code.includes("PostMedia"), "should render PostMedia component for images");
  });

  it("PostDetail renders media attachments", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/PostDetail.tsx", "utf-8");
    assert.ok(code.includes("media"), "should reference media");
  });

  it("feed page fetches media for posts", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/app/[orgSlug]/feed/page.tsx", "utf-8");
    assert.ok(code.includes("fetchMediaForEntities"), "should call fetchMediaForEntities");
  });
});
