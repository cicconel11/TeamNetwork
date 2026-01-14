import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  galleryUploadIntentSchema,
  galleryUpdateMediaSchema,
  moderateMediaSchema,
  mediaListQuerySchema,
  GALLERY_ALLOWED_MIME_TYPES,
} from "@/lib/schemas/media";

describe("galleryUploadIntentSchema", () => {
  const validPayload = {
    orgId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 1024 * 1024, // 1MB
  };

  it("accepts valid minimal payload", () => {
    const result = galleryUploadIntentSchema.safeParse(validPayload);
    assert.ok(result.success);
    assert.strictEqual(result.data.orgId, validPayload.orgId);
    assert.strictEqual(result.data.fileName, validPayload.fileName);
  });

  it("accepts valid payload with optional fields", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      title: "Summer BBQ",
      description: "Photos from the summer BBQ event",
      tags: ["summer", "BBQ", "2026"],
      takenAt: "2026-06-15T14:30:00Z",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.title, "Summer BBQ");
    assert.deepStrictEqual(result.data.tags, ["summer", "bbq", "2026"]); // lowercase transform
  });

  it("deduplicates tags", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      tags: ["Summer", "summer", "SUMMER"],
    });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.tags, ["summer"]);
  });

  it("defaults tags to empty array", () => {
    const result = galleryUploadIntentSchema.safeParse(validPayload);
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.tags, []);
  });

  it("rejects invalid orgId", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      orgId: "not-a-uuid",
    });
    assert.ok(!result.success);
  });

  it("rejects unsupported MIME type", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      mimeType: "application/pdf",
    });
    assert.ok(!result.success);
  });

  it("rejects image over 10MB", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      mimeType: "image/jpeg",
      fileSizeBytes: 11 * 1024 * 1024, // 11MB
    });
    assert.ok(!result.success);
  });

  it("allows video up to 100MB", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      mimeType: "video/mp4",
      fileSizeBytes: 99 * 1024 * 1024, // 99MB
    });
    assert.ok(result.success);
  });

  it("rejects video over 100MB", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      mimeType: "video/mp4",
      fileSizeBytes: 101 * 1024 * 1024, // 101MB
    });
    assert.ok(!result.success);
  });

  it("rejects negative file size", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      fileSizeBytes: -1,
    });
    assert.ok(!result.success);
  });

  it("rejects empty fileName", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      fileName: "",
    });
    assert.ok(!result.success);
  });

  it("rejects tags with special characters", () => {
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      tags: ["<script>alert(1)</script>"],
    });
    assert.ok(!result.success);
  });

  it("rejects more than 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const result = galleryUploadIntentSchema.safeParse({
      ...validPayload,
      tags,
    });
    assert.ok(!result.success);
  });
});

describe("galleryUpdateMediaSchema", () => {
  it("accepts valid partial update", () => {
    const result = galleryUpdateMediaSchema.safeParse({
      title: "Updated Title",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.title, "Updated Title");
  });

  it("accepts tags update with lowercase transform", () => {
    const result = galleryUpdateMediaSchema.safeParse({
      tags: ["Event", "PHOTO"],
    });
    assert.ok(result.success);
    assert.deepStrictEqual(result.data.tags, ["event", "photo"]);
  });

  it("accepts null takenAt to clear the field", () => {
    const result = galleryUpdateMediaSchema.safeParse({
      takenAt: null,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.takenAt, null);
  });

  it("rejects title over 200 chars", () => {
    const result = galleryUpdateMediaSchema.safeParse({
      title: "x".repeat(201),
    });
    assert.ok(!result.success);
  });

  it("accepts empty object (no fields)", () => {
    const result = galleryUpdateMediaSchema.safeParse({});
    assert.ok(result.success);
  });
});

describe("moderateMediaSchema", () => {
  it("accepts approve action", () => {
    const result = moderateMediaSchema.safeParse({
      action: "approve",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.action, "approve");
  });

  it("accepts reject with reason", () => {
    const result = moderateMediaSchema.safeParse({
      action: "reject",
      rejectionReason: "Inappropriate content",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.action, "reject");
  });

  it("rejects reject without reason", () => {
    const result = moderateMediaSchema.safeParse({
      action: "reject",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid action", () => {
    const result = moderateMediaSchema.safeParse({
      action: "delete",
    });
    assert.ok(!result.success);
  });

  it("rejects rejection reason over 1000 chars", () => {
    const result = moderateMediaSchema.safeParse({
      action: "reject",
      rejectionReason: "x".repeat(1001),
    });
    assert.ok(!result.success);
  });
});

describe("mediaListQuerySchema", () => {
  const validQuery = {
    orgId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  };

  it("accepts minimal query with defaults", () => {
    const result = mediaListQuerySchema.safeParse(validQuery);
    assert.ok(result.success);
    assert.strictEqual(result.data.limit, 24);
    assert.strictEqual(result.data.cursor, undefined);
  });

  it("accepts full query with all filters", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      cursor: "some-cursor-value",
      limit: 50,
      tag: "summer",
      year: 2026,
      mediaType: "image",
      status: "pending",
      uploadedBy: "self",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.limit, 50);
    assert.strictEqual(result.data.uploadedBy, "self");
  });

  it("coerces limit from string", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      limit: "30",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.limit, 30);
  });

  it("clamps limit to max 100", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      limit: 999,
    });
    assert.ok(!result.success);
  });

  it("rejects invalid year", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      year: 1800,
    });
    assert.ok(!result.success);
  });

  it("rejects invalid mediaType", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      mediaType: "audio",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid status", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      status: "deleted",
    });
    assert.ok(!result.success);
  });

  it("accepts uploadedBy as UUID", () => {
    const result = mediaListQuerySchema.safeParse({
      ...validQuery,
      uploadedBy: "b1c2d3e4-f5a6-7890-bcde-f12345678901",
    });
    assert.ok(result.success);
  });
});

describe("GALLERY_ALLOWED_MIME_TYPES", () => {
  it("includes expected image types", () => {
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("image/jpeg"));
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("image/png"));
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("image/webp"));
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("image/heic"));
  });

  it("includes expected video types", () => {
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("video/mp4"));
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("video/quicktime"));
    assert.ok(GALLERY_ALLOWED_MIME_TYPES.has("video/webm"));
  });

  it("does not include non-media types", () => {
    assert.ok(!GALLERY_ALLOWED_MIME_TYPES.has("application/pdf"));
    assert.ok(!GALLERY_ALLOWED_MIME_TYPES.has("text/plain"));
    assert.ok(!GALLERY_ALLOWED_MIME_TYPES.has("image/gif"));
  });
});
