import test from "node:test";
import assert from "node:assert/strict";
import {
  validateGalleryRawFile,
  validateGalleryPreparedSize,
  GALLERY_IMAGE_MAX_BYTES,
  GALLERY_RAW_IMAGE_MAX_BYTES,
} from "@/lib/media/gallery-validation";

// A real 14 MB JPEG is the motivating case — iPhone photo that compresses to
// ~600 KB after prepareImageUpload but would previously be rejected pre-prep.
test("validateGalleryRawFile accepts a 14 MB JPEG (raw size no longer gates)", () => {
  const bytes = new Uint8Array(14 * 1024 * 1024);
  const file = new File([bytes], "IMG_0001.jpeg", { type: "image/jpeg" });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, true);
});

test("validateGalleryRawFile accepts a 49 MB JPEG at the raw image boundary", () => {
  const file = new File([new Uint8Array(0)], "large.jpeg", { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: 49 * 1024 * 1024 });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, true);
});

test("validateGalleryRawFile rejects a 51 MB JPEG before prep", () => {
  const file = new File([new Uint8Array(0)], "too-large.jpeg", { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: 51 * 1024 * 1024 });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.equal(result.error, "Images must be under 50 MB before upload.");
});

test("validateGalleryRawFile rejects HEIC with browser-conversion message", () => {
  const file = new File(["heic"], "photo.heic", { type: "image/heic" });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.equal(
    result.error,
    "HEIC uploads are not supported in the browser yet. Convert to JPG, PNG, or WebP first.",
  );
});

test("validateGalleryRawFile infers image/heic from extension when browser omits file.type", () => {
  const file = new File(["heic"], "photo.HEIC", { type: "" });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.match(result.error ?? "", /HEIC/);
});

test("validateGalleryRawFile rejects unsupported mime", () => {
  const file = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.match(result.error ?? "", /Unsupported file type/);
});

test("validateGalleryRawFile rejects empty files", () => {
  const file = new File([], "empty.jpg", { type: "image/jpeg" });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.equal(result.error, "File is empty.");
});

test("validateGalleryRawFile rejects videos over the 100 MB cap", () => {
  const file = new File([new Uint8Array(0)], "movie.mp4", { type: "video/mp4" });
  // File constructor won't actually honor a 200MB blob; override size for the
  // assertion via Object.defineProperty which is how we simulate large files.
  Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, false);
  assert.equal(result.error, "Videos must be under 100 MB.");
});

test("validateGalleryRawFile accepts videos at 100 MB boundary", () => {
  const file = new File([new Uint8Array(0)], "movie.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 });
  const result = validateGalleryRawFile(file);
  assert.equal(result.valid, true);
});

test("validateGalleryPreparedSize accepts a 600 KB image", () => {
  const result = validateGalleryPreparedSize(600_000, "image/jpeg");
  assert.equal(result.valid, true);
});

test("validateGalleryPreparedSize rejects an 11 MB image", () => {
  const result = validateGalleryPreparedSize(11 * 1024 * 1024, "image/jpeg");
  assert.equal(result.valid, false);
  assert.equal(result.error, "Images must be under 10 MB.");
});

test("validateGalleryPreparedSize accepts exactly 10 MB", () => {
  const result = validateGalleryPreparedSize(GALLERY_IMAGE_MAX_BYTES, "image/jpeg");
  assert.equal(result.valid, true);
});

test("validateGalleryPreparedSize is a no-op for videos (video cap is raw-time)", () => {
  const result = validateGalleryPreparedSize(80 * 1024 * 1024, "video/mp4");
  assert.equal(result.valid, true);
});

test("GALLERY_IMAGE_MAX_BYTES is exported as the 10 MB constant", () => {
  assert.equal(GALLERY_IMAGE_MAX_BYTES, 10 * 1024 * 1024);
});

test("GALLERY_RAW_IMAGE_MAX_BYTES is exported as the 50 MB constant", () => {
  assert.equal(GALLERY_RAW_IMAGE_MAX_BYTES, 50 * 1024 * 1024);
});
