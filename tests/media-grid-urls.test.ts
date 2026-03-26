import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { batchGetGridPreviewUrls } from "@/lib/media/urls";
import { getCardDisplayUrl } from "@/lib/media/display-url";

describe("batchGetGridPreviewUrls", () => {
  it("signs one transform URL per image and does not sign full video files for grid", async () => {
    const calls: string[] = [];
    const mockClient = {
      storage: {
        from: () => ({
          createSignedUrl: async (
            _path: string,
            _exp: number,
            opts?: { transform?: unknown },
          ) => {
            calls.push(opts?.transform ? "transform" : "full");
            return { data: { signedUrl: "https://example.com/signed" } };
          },
        }),
      },
    };

    const map = await batchGetGridPreviewUrls(mockClient as never, [
      { id: "a", storage_path: "o/i/1.jpg", mime_type: "image/jpeg", media_type: "image" },
      { id: "b", storage_path: "o/v/1.mp4", mime_type: "video/mp4", media_type: "video" },
    ]);

    assert.equal(calls.filter((c) => c === "transform").length, 1);
    assert.equal(calls.filter((c) => c === "full").length, 0);
    assert.ok(map.get("a")?.thumbnailUrl);
    assert.equal(map.get("b")?.thumbnailUrl, null);
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
