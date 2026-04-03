import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchGetGridPreviewUrls,
  batchGetMediaBrowseUrls,
  getMediaUrls,
} from "@/lib/media/urls";
import { getCardDisplayUrl } from "@/lib/media/display-url";

function createMockClient() {
  const calls: string[] = [];
  const mockClient = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          calls.push(path);
          return { data: { signedUrl: `https://example.com/${path}` } };
        },
      }),
    },
  };

  return { calls, mockClient };
}

describe("batchGetGridPreviewUrls", () => {
  it("uses stored preview assets for images and skips video originals", async () => {
    const { calls, mockClient } = createMockClient();

    const map = await batchGetGridPreviewUrls(mockClient as never, [
      {
        id: "a",
        storage_path: "o/i/1.jpg",
        preview_storage_path: "o/i/1-preview.jpg",
        mime_type: "image/jpeg",
        media_type: "image",
      },
      { id: "b", storage_path: "o/v/1.mp4", mime_type: "video/mp4", media_type: "video" },
    ]);

    assert.deepEqual(calls, ["o/i/1-preview.jpg"]);
    assert.equal(map.get("a")?.thumbnailUrl, "https://example.com/o/i/1-preview.jpg");
    assert.equal(map.get("b")?.thumbnailUrl, null);
  });
});

describe("batchGetMediaBrowseUrls", () => {
  it("does not sign originals when a preview path exists", async () => {
    const { calls, mockClient } = createMockClient();

    const map = await batchGetMediaBrowseUrls(mockClient as never, [
      { id: "browse-1", storage_path: "feed/full.jpg", preview_storage_path: "feed/preview.jpg" },
    ]);

    assert.deepEqual(calls, ["feed/preview.jpg"]);
    assert.equal(map.get("browse-1")?.thumbnailUrl, "https://example.com/feed/preview.jpg");
  });

  it("falls back to the original path for older rows without stored previews", async () => {
    const { calls, mockClient } = createMockClient();

    const map = await batchGetMediaBrowseUrls(mockClient as never, [
      { id: "browse-2", storage_path: "feed/legacy.jpg" },
    ]);

    assert.deepEqual(calls, ["feed/legacy.jpg"]);
    assert.equal(map.get("browse-2")?.thumbnailUrl, "https://example.com/feed/legacy.jpg");
  });
});

describe("getMediaUrls", () => {
  it("signs original and preview paths separately for detail views", async () => {
    const { calls, mockClient } = createMockClient();

    const urls = await getMediaUrls(
      mockClient as never,
      "media/original.jpg",
      "media/preview.jpg",
    );

    assert.deepEqual(calls, ["media/original.jpg", "media/preview.jpg"]);
    assert.equal(urls.originalUrl, "https://example.com/media/original.jpg");
    assert.equal(urls.previewUrl, "https://example.com/media/preview.jpg");
  });
});

describe("getCardDisplayUrl (grid thumbnail-first)", () => {
  it("uses thumbnail_url for images when url is omitted", () => {
    const u = getCardDisplayUrl({
      media_type: "image",
      thumbnail_url: "https://cdn/thumb.jpg",
      url: null,
      external_url: null,
    });
    assert.equal(u, "https://cdn/thumb.jpg");
  });
});
