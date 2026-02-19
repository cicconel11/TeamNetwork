import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCardDisplayUrl } from "@/lib/media/display-url";

describe("getCardDisplayUrl", () => {
  it("returns null for video with no thumbnail (prevents .mp4 in Image optimizer)", () => {
    const result = getCardDisplayUrl({
      media_type: "video",
      thumbnail_url: null,
      url: "https://storage.example.com/org/video.mp4",
      external_url: null,
    });
    assert.equal(result, null);
  });

  it("returns thumbnail_url for video that has a server-generated thumbnail", () => {
    const result = getCardDisplayUrl({
      media_type: "video",
      thumbnail_url: "https://storage.example.com/org/thumb.jpg",
      url: "https://storage.example.com/org/video.mp4",
      external_url: null,
    });
    assert.equal(result, "https://storage.example.com/org/thumb.jpg");
  });

  it("returns thumbnail_url for image when available", () => {
    const result = getCardDisplayUrl({
      media_type: "image",
      thumbnail_url: "https://storage.example.com/org/thumb.jpg",
      url: "https://storage.example.com/org/photo.jpg",
      external_url: null,
    });
    assert.equal(result, "https://storage.example.com/org/thumb.jpg");
  });

  it("falls back to url for image with no thumbnail", () => {
    const result = getCardDisplayUrl({
      media_type: "image",
      thumbnail_url: null,
      url: "https://storage.example.com/org/photo.jpg",
      external_url: null,
    });
    assert.equal(result, "https://storage.example.com/org/photo.jpg");
  });

  it("falls back to external_url for image with no thumbnail or url", () => {
    const result = getCardDisplayUrl({
      media_type: "image",
      thumbnail_url: null,
      url: null,
      external_url: "https://cdn.example.com/photo.jpg",
    });
    assert.equal(result, "https://cdn.example.com/photo.jpg");
  });

  it("returns null for image with no URLs at all", () => {
    const result = getCardDisplayUrl({
      media_type: "image",
      thumbnail_url: null,
      url: null,
      external_url: null,
    });
    assert.equal(result, null);
  });

  it("does not fall back to url or external_url for video", () => {
    const result = getCardDisplayUrl({
      media_type: "video",
      thumbnail_url: null,
      url: "https://storage.example.com/org/clip.mp4",
      external_url: "https://cdn.example.com/clip.mp4",
    });
    assert.equal(result, null);
  });
});
