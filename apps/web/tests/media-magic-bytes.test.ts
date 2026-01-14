import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateMagicBytes } from "@/lib/media/validation";

describe("validateMagicBytes", () => {
  describe("image/png", () => {
    it("accepts valid PNG header", () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      assert.ok(validateMagicBytes(buf, "image/png"));
    });

    it("rejects buffer with wrong bytes", () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00]);
      assert.ok(!validateMagicBytes(buf, "image/png"));
    });
  });

  describe("image/jpeg", () => {
    it("accepts valid JPEG header", () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      assert.ok(validateMagicBytes(buf, "image/jpeg"));
    });

    it("also works for image/jpg alias", () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe1]);
      assert.ok(validateMagicBytes(buf, "image/jpg"));
    });
  });

  describe("image/gif", () => {
    it("accepts GIF87a", () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]);
      assert.ok(validateMagicBytes(buf, "image/gif"));
    });

    it("accepts GIF89a", () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
      assert.ok(validateMagicBytes(buf, "image/gif"));
    });
  });

  describe("image/webp", () => {
    it("accepts valid WebP (RIFF + WEBP)", () => {
      // RIFF....WEBP
      const buf = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00, // file size (placeholder)
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      assert.ok(validateMagicBytes(buf, "image/webp"));
    });

    it("rejects RIFF without WEBP at offset 8", () => {
      const buf = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x41, 0x56, 0x49, 0x20, // AVI (not WEBP)
      ]);
      assert.ok(!validateMagicBytes(buf, "image/webp"));
    });

    it("rejects RIFF with insufficient length", () => {
      const buf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
      assert.ok(!validateMagicBytes(buf, "image/webp"));
    });
  });

  describe("image/heic", () => {
    it("accepts valid HEIC with heic brand", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x1c, // box size
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x68, 0x65, 0x69, 0x63, // heic
      ]);
      assert.ok(validateMagicBytes(buf, "image/heic"));
    });

    it("accepts valid HEIC with heix brand", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x1c,
        0x66, 0x74, 0x79, 0x70,
        0x68, 0x65, 0x69, 0x78, // heix
      ]);
      assert.ok(validateMagicBytes(buf, "image/heic"));
    });

    it("accepts valid HEIC with mif1 brand", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x1c,
        0x66, 0x74, 0x79, 0x70,
        0x6d, 0x69, 0x66, 0x31, // mif1
      ]);
      assert.ok(validateMagicBytes(buf, "image/heic"));
    });

    it("rejects ftyp with unknown brand", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x1c,
        0x66, 0x74, 0x79, 0x70,
        0x69, 0x73, 0x6f, 0x6d, // isom (not a HEIC brand)
      ]);
      assert.ok(!validateMagicBytes(buf, "image/heic"));
    });

    it("rejects too-short buffer", () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]);
      assert.ok(!validateMagicBytes(buf, "image/heic"));
    });
  });

  describe("video/mp4", () => {
    it("accepts ftyp at offset 4", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x1c, // box size
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x69, 0x73, 0x6f, 0x6d, // isom brand
      ]);
      assert.ok(validateMagicBytes(buf, "video/mp4"));
    });
  });

  describe("video/quicktime", () => {
    it("accepts ftyp at offset 4", () => {
      const buf = Buffer.from([
        0x00, 0x00, 0x00, 0x14,
        0x66, 0x74, 0x79, 0x70, // ftyp
        0x71, 0x74, 0x20, 0x20, // qt brand
      ]);
      assert.ok(validateMagicBytes(buf, "video/quicktime"));
    });
  });

  describe("video/webm", () => {
    it("accepts EBML header", () => {
      const buf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00]);
      assert.ok(validateMagicBytes(buf, "video/webm"));
    });
  });

  describe("unknown type", () => {
    it("returns false for unsupported MIME type", () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      assert.ok(!validateMagicBytes(buf, "application/pdf"));
    });
  });

  describe("edge cases", () => {
    it("returns false for empty buffer", () => {
      const buf = Buffer.alloc(0);
      assert.ok(!validateMagicBytes(buf, "image/png"));
    });

    it("returns false for buffer shorter than signature", () => {
      const buf = Buffer.from([0x89, 0x50]);
      assert.ok(!validateMagicBytes(buf, "image/png"));
    });
  });
});
