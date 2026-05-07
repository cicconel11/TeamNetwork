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
  const batchCalls: string[][] = [];
  const mockClient = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          calls.push(path);
          return { data: { signedUrl: `https://example.com/${path}` } };
        },
        createSignedUrls: async (paths: string[]) => {
          batchCalls.push(paths);
          return {
            data: paths.map((p) => ({ path: p, signedUrl: `https://example.com/${p}`, error: null })),
            error: null,
          };
        },
      }),
    },
  };

  return { calls, batchCalls, mockClient };
}

describe("batchGetGridPreviewUrls", () => {
  it("uses stored preview assets for images and skips video originals", async () => {
    const { batchCalls, mockClient } = createMockClient();

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

    assert.equal(batchCalls.length, 1);
    assert.deepEqual(batchCalls[0], ["o/i/1-preview.jpg"]);
    assert.equal(map.get("a")?.thumbnailUrl, "https://example.com/o/i/1-preview.jpg");
    assert.equal(map.get("b")?.thumbnailUrl, null);
  });

  it("returns null thumbnails when createSignedUrls fails", async () => {
    const errorClient = {
      storage: {
        from: () => ({
          createSignedUrls: async () => ({ data: null, error: { message: "storage down" } }),
        }),
      },
    };

    const map = await batchGetGridPreviewUrls(errorClient as never, [
      { id: "err-a", storage_path: "o/i/1.jpg", mime_type: "image/jpeg", media_type: "image" as const },
      { id: "err-b", storage_path: "o/i/2.jpg", mime_type: "image/jpeg", media_type: "image" as const },
    ]);

    assert.equal(map.get("err-a")?.thumbnailUrl, null);
    assert.equal(map.get("err-b")?.thumbnailUrl, null);
  });

  it("makes exactly 1 batch call for multiple images", async () => {
    const { batchCalls, mockClient } = createMockClient();

    const media = Array.from({ length: 5 }, (_, i) => ({
      id: `img-${i}`,
      storage_path: `o/i/${i}.jpg`,
      preview_storage_path: `o/i/${i}-preview.jpg`,
      mime_type: "image/jpeg" as const,
      media_type: "image" as const,
    }));

    const map = await batchGetGridPreviewUrls(mockClient as never, media);

    assert.equal(batchCalls.length, 1, "should make exactly 1 batch SDK call");
    assert.equal(batchCalls[0].length, 5, "batch call should contain all 5 paths");
    for (let i = 0; i < 5; i++) {
      assert.equal(
        map.get(`img-${i}`)?.thumbnailUrl,
        `https://example.com/o/i/${i}-preview.jpg`,
      );
    }
  });
});

describe("batchGetMediaBrowseUrls", () => {
  it("does not sign originals when a preview path exists", async () => {
    const { batchCalls, mockClient } = createMockClient();

    const map = await batchGetMediaBrowseUrls(mockClient as never, [
      { id: "browse-1", storage_path: "feed/full.jpg", preview_storage_path: "feed/preview.jpg" },
    ]);

    assert.equal(batchCalls.length, 1);
    assert.deepEqual(batchCalls[0], ["feed/preview.jpg"]);
    assert.equal(map.get("browse-1")?.thumbnailUrl, "https://example.com/feed/preview.jpg");
  });

  it("falls back to the original path for older rows without stored previews", async () => {
    const { batchCalls, mockClient } = createMockClient();

    const map = await batchGetMediaBrowseUrls(mockClient as never, [
      { id: "browse-2", storage_path: "feed/legacy.jpg" },
    ]);

    assert.equal(batchCalls.length, 1);
    assert.deepEqual(batchCalls[0], ["feed/legacy.jpg"]);
    assert.equal(map.get("browse-2")?.thumbnailUrl, "https://example.com/feed/legacy.jpg");
  });

  it("returns null thumbnails when createSignedUrls fails", async () => {
    const errorClient = {
      storage: {
        from: () => ({
          createSignedUrls: async () => ({ data: null, error: { message: "storage down" } }),
        }),
      },
    };

    const map = await batchGetMediaBrowseUrls(errorClient as never, [
      { id: "err-1", storage_path: "feed/a.jpg" },
      { id: "err-2", storage_path: "feed/b.jpg" },
    ]);

    assert.equal(map.get("err-1")?.thumbnailUrl, null);
    assert.equal(map.get("err-2")?.thumbnailUrl, null);
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
