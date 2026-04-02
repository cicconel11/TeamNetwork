import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fitWithinBounds,
  MEDIA_IMAGE_LIMITS,
  resolveImagePreparationPolicy,
} from "@/lib/media/image-preparation";

describe("fitWithinBounds", () => {
  it("keeps images smaller than the limit unchanged", () => {
    assert.deepEqual(fitWithinBounds(1200, 800, MEDIA_IMAGE_LIMITS.originalMaxLongEdge), {
      width: 1200,
      height: 800,
    });
  });

  it("scales wide images to the configured max long edge", () => {
    assert.deepEqual(fitWithinBounds(4000, 2000, MEDIA_IMAGE_LIMITS.originalMaxLongEdge), {
      width: 1920,
      height: 960,
    });
  });

  it("scales tall images to the configured max width for browse previews", () => {
    assert.deepEqual(fitWithinBounds(1200, 3600, MEDIA_IMAGE_LIMITS.previewMaxWidth), {
      width: 341,
      height: 1024,
    });
  });
});

describe("resolveImagePreparationPolicy", () => {
  it("keeps PNG uploads lossless", () => {
    assert.deepEqual(resolveImagePreparationPolicy("image/png"), {
      outputMimeType: "image/png",
      previewMimeType: "image/png",
      preserveOriginalFile: false,
    });
  });

  it("keeps WebP uploads as WebP", () => {
    assert.deepEqual(resolveImagePreparationPolicy("image/webp"), {
      outputMimeType: "image/webp",
      previewMimeType: "image/webp",
      preserveOriginalFile: false,
    });
  });

  it("preserves animated GIF originals while still producing JPEG previews", () => {
    assert.deepEqual(resolveImagePreparationPolicy("image/gif"), {
      outputMimeType: "image/gif",
      previewMimeType: "image/jpeg",
      preserveOriginalFile: true,
    });
  });

  it("rejects HEIC until browser conversion support is added", () => {
    assert.throws(
      () => resolveImagePreparationPolicy("image/heic"),
      /HEIC uploads are not supported in the browser yet/,
    );
  });
});
