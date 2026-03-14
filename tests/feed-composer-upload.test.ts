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

  it("FeedComposer validates file size client-side", async () => {
    const fs = await import("fs");
    const code = fs.readFileSync("src/components/feed/FeedComposer.tsx", "utf-8");
    assert.ok(
      code.includes("10 * 1024 * 1024") || code.includes("MAX_FILE_SIZE"),
      "should have 10MB max file size check",
    );
  });
});
