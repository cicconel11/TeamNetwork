import test, { describe } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { validateMagicBytes, validateFileConstraints } from "@/lib/media/validation";
import { MEDIA_CONSTRAINTS, isImageMimeType } from "@/lib/media/constants";
import { uploadIntentSchema, finalizeUploadSchema, mediaIdsSchema } from "@/lib/schemas/media";

// Pre-generate valid v4 UUIDs for test fixtures
const ORG_ID = randomUUID();
const MEDIA_ID = randomUUID();
const ENTITY_ID = randomUUID();

// ─── Magic Bytes Validation ───────────────────────────────────────────────────

describe("validateMagicBytes", () => {
  test("validates PNG magic bytes", () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(pngHeader, "image/png"), true);
  });

  test("validates JPEG magic bytes", () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(jpegHeader, "image/jpeg"), true);
  });

  test("validates JPEG with image/jpg alias", () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(jpegHeader, "image/jpg"), true);
  });

  test("validates GIF87a magic bytes", () => {
    const gif87a = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(gif87a, "image/gif"), true);
  });

  test("validates GIF89a magic bytes", () => {
    const gif89a = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(gif89a, "image/gif"), true);
  });

  test("validates WebP magic bytes (RIFF + WEBP)", () => {
    const webp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // file size (placeholder)
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(validateMagicBytes(webp, "image/webp"), true);
  });

  test("rejects WebP with RIFF header but missing WEBP marker", () => {
    const notWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00,
      0x41, 0x56, 0x49, 0x20, // AVI instead of WEBP
      0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(validateMagicBytes(notWebp, "image/webp"), false);
  });

  test("validates MP4 magic bytes (ftyp at offset 4)", () => {
    const mp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x18, // box size
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d, // isom brand
      0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(validateMagicBytes(mp4, "video/mp4"), true);
  });

  test("validates WebM magic bytes (EBML header)", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(webm, "video/webm"), true);
  });

  test("validates QuickTime magic bytes", () => {
    const mov = Buffer.from([
      0x00, 0x00, 0x00, 0x14,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x71, 0x74, 0x20, 0x20, // qt brand
    ]);
    assert.strictEqual(validateMagicBytes(mov, "video/quicktime"), true);
  });

  test("rejects spoofed MIME type (PNG header claimed as JPEG)", () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.strictEqual(validateMagicBytes(pngHeader, "image/jpeg"), false);
  });

  test("rejects unknown MIME type", () => {
    const data = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    assert.strictEqual(validateMagicBytes(data, "application/pdf"), false);
  });

  test("rejects buffer too short for signature", () => {
    const tooShort = Buffer.from([0x89, 0x50]);
    assert.strictEqual(validateMagicBytes(tooShort, "image/png"), false);
  });

  test("rejects empty buffer", () => {
    assert.strictEqual(validateMagicBytes(Buffer.alloc(0), "image/png"), false);
  });
});

// ─── File Constraints Validation ──────────────────────────────────────────────

describe("validateFileConstraints", () => {
  test("accepts valid image for feed_post", () => {
    const result = validateFileConstraints("feed_post", "image/png", 5 * 1024 * 1024);
    assert.strictEqual(result, null);
  });

  test("accepts valid video for feed_post", () => {
    const result = validateFileConstraints("feed_post", "video/mp4", 9 * 1024 * 1024);
    assert.strictEqual(result, null);
  });

  test("rejects video for discussion_thread", () => {
    const result = validateFileConstraints("discussion_thread", "video/mp4", 5 * 1024 * 1024);
    assert.ok(result !== null);
    assert.ok(result.includes("not allowed"));
  });

  test("rejects video for job_posting", () => {
    const result = validateFileConstraints("job_posting", "video/webm", 1 * 1024 * 1024);
    assert.ok(result !== null);
    assert.ok(result.includes("not allowed"));
  });

  test("rejects file exceeding size limit for feed_post", () => {
    const result = validateFileConstraints("feed_post", "image/png", 11 * 1024 * 1024);
    assert.ok(result !== null);
    assert.ok(result.includes("exceeds"));
  });

  test("rejects file exceeding size limit for job_posting (5MB)", () => {
    const result = validateFileConstraints("job_posting", "image/jpeg", 6 * 1024 * 1024);
    assert.ok(result !== null);
    assert.ok(result.includes("exceeds"));
  });

  test("rejects unsupported MIME type", () => {
    const result = validateFileConstraints("feed_post", "application/pdf", 1024);
    assert.ok(result !== null);
    assert.ok(result.includes("not allowed"));
  });
});

// ─── MEDIA_CONSTRAINTS ──────────────────────────────────────────────────────

describe("MEDIA_CONSTRAINTS", () => {
  test("feed_post allows 4 attachments", () => {
    assert.strictEqual(MEDIA_CONSTRAINTS.feed_post.maxAttachments, 4);
  });

  test("discussion_thread allows 3 attachments", () => {
    assert.strictEqual(MEDIA_CONSTRAINTS.discussion_thread.maxAttachments, 3);
  });

  test("job_posting allows 1 attachment", () => {
    assert.strictEqual(MEDIA_CONSTRAINTS.job_posting.maxAttachments, 1);
  });

  test("feed_post max size is 10MB", () => {
    assert.strictEqual(MEDIA_CONSTRAINTS.feed_post.maxFileSize, 10 * 1024 * 1024);
  });

  test("job_posting max size is 5MB", () => {
    assert.strictEqual(MEDIA_CONSTRAINTS.job_posting.maxFileSize, 5 * 1024 * 1024);
  });
});

// ─── isImageMimeType ────────────────────────────────────────────────────────

describe("isImageMimeType", () => {
  test("returns true for image types", () => {
    assert.strictEqual(isImageMimeType("image/png"), true);
    assert.strictEqual(isImageMimeType("image/jpeg"), true);
    assert.strictEqual(isImageMimeType("image/webp"), true);
    assert.strictEqual(isImageMimeType("image/gif"), true);
  });

  test("returns false for video types", () => {
    assert.strictEqual(isImageMimeType("video/mp4"), false);
    assert.strictEqual(isImageMimeType("video/webm"), false);
  });

  test("returns false for other types", () => {
    assert.strictEqual(isImageMimeType("application/pdf"), false);
  });
});

// ─── Zod Schemas ────────────────────────────────────────────────────────────

describe("uploadIntentSchema", () => {
  const validInput = {
    orgId: ORG_ID,
    feature: "feed_post",
    fileName: "photo.png",
    mimeType: "image/png",
    fileSize: 1024,
  };

  test("accepts valid input", () => {
    const result = uploadIntentSchema.safeParse(validInput);
    assert.strictEqual(result.success, true);
  });

  test("rejects invalid feature", () => {
    const result = uploadIntentSchema.safeParse({ ...validInput, feature: "blog_post" });
    assert.strictEqual(result.success, false);
  });

  test("rejects negative fileSize", () => {
    const result = uploadIntentSchema.safeParse({ ...validInput, fileSize: -1 });
    assert.strictEqual(result.success, false);
  });

  test("rejects fileSize exceeding 25MB", () => {
    const result = uploadIntentSchema.safeParse({ ...validInput, fileSize: 26 * 1024 * 1024 });
    assert.strictEqual(result.success, false);
  });

  test("rejects missing orgId", () => {
    const { orgId: _, ...noOrg } = validInput;
    const result = uploadIntentSchema.safeParse(noOrg);
    assert.strictEqual(result.success, false);
  });
});

describe("finalizeUploadSchema", () => {
  const validBase = {
    orgId: ORG_ID,
    mediaId: MEDIA_ID,
  };

  test("accepts without entity fields", () => {
    const result = finalizeUploadSchema.safeParse(validBase);
    assert.strictEqual(result.success, true);
  });

  test("accepts with both entity fields", () => {
    const result = finalizeUploadSchema.safeParse({
      ...validBase,
      entityType: "feed_post",
      entityId: ENTITY_ID,
    });
    assert.strictEqual(result.success, true);
  });

  test("rejects entityType without entityId", () => {
    const result = finalizeUploadSchema.safeParse({
      ...validBase,
      entityType: "feed_post",
    });
    assert.strictEqual(result.success, false);
  });

  test("rejects entityId without entityType", () => {
    const result = finalizeUploadSchema.safeParse({
      ...validBase,
      entityId: ENTITY_ID,
    });
    assert.strictEqual(result.success, false);
  });
});

describe("mediaIdsSchema", () => {
  test("defaults to empty array", () => {
    const result = mediaIdsSchema.safeParse(undefined);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data, []);
    }
  });

  test("accepts valid UUID array", () => {
    const result = mediaIdsSchema.safeParse([randomUUID(), randomUUID()]);
    assert.strictEqual(result.success, true);
  });

  test("rejects non-UUID strings", () => {
    const result = mediaIdsSchema.safeParse(["not-a-uuid"]);
    assert.strictEqual(result.success, false);
  });

  test("rejects array exceeding max (10)", () => {
    const ids = Array.from({ length: 11 }, () => randomUUID());
    const result = mediaIdsSchema.safeParse(ids);
    assert.strictEqual(result.success, false);
  });
});
