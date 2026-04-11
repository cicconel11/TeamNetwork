// tests/feed-composer-upload.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("FeedComposer image upload", () => {
  it("FeedComposer has image upload button", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedComposer.tsx", "utf-8");
    assert.ok(code.includes('type="file"'), "should have a file input");
    assert.ok(code.includes("accept="), "should restrict accepted file types");
  });

  it("FeedComposer shows image preview state", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedComposer.tsx", "utf-8");
    assert.ok(code.includes("previewUrl"), "should track image preview URL");
  });

  it("FeedComposer uses upload-intent flow", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedComposer.tsx", "utf-8");
    assert.ok(code.includes("/api/media/upload-intent"), "should call upload-intent API");
    assert.ok(code.includes("/api/media/finalize"), "should call finalize API");
    assert.ok(code.includes("mediaIds"), "should pass mediaIds to post creation");
  });

  it("FeedComposer validates file size client-side via prepareFeedImageEntries", async () => {
    const fs = await import("fs");
    const composer = fs.readFileSync("src/components/feed/FeedComposer.tsx", "utf-8");
    assert.ok(
      composer.includes("prepareFeedImageEntries"),
      "FeedComposer should delegate file validation to prepareFeedImageEntries",
    );

    // The helper owns the post-prep 10 MB gate.
    const helper = fs.readFileSync("src/lib/media/feed-composer-prep.ts", "utf-8");
    assert.ok(
      helper.includes("FEED_POST_MAX_FILE_SIZE"),
      "feed-composer-prep should expose the feed post size constant",
    );
    assert.ok(
      helper.includes("MEDIA_CONSTRAINTS.feed_post.maxFileSize"),
      "feed-composer-prep should derive the cap from MEDIA_CONSTRAINTS",
    );
  });
});
