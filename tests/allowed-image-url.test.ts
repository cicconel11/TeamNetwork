import { describe, it } from "node:test";
import assert from "node:assert";
import { allowedImageUrl, ALLOWED_IMAGE_HOSTS } from "../src/lib/security/validation";

describe("allowedImageUrl validation", () => {
  describe("accepts allowed hosts", () => {
    it("accepts Supabase storage URLs", () => {
      const url = "https://rytsziwekhtjdqzzpdso.supabase.co/storage/v1/object/public/org-branding/logo.png";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, true);
    });

    it("accepts Google user content URLs", () => {
      const url = "https://lh3.googleusercontent.com/a/user-photo-hash";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, true);
    });

    it("accepts GitHub avatar URLs", () => {
      const url = "https://avatars.githubusercontent.com/u/12345678";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, true);
    });

    it("accepts LinkedIn media URLs", () => {
      const url = "https://media.licdn.com/dms/image/some-image-path";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, true);
    });
  });

  describe("rejects disallowed hosts", () => {
    it("rejects Google Drive share links with helpful message", () => {
      const url = "https://drive.google.com/file/d/1KX0h_2T91jdarsbVwr869bIQCwJV7fkl/view?usp=sharing";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, false);
      if (!result.success) {
        assert.ok(result.error.issues[0].message.includes("download the image"));
      }
    });

    it("rejects Dropbox links", () => {
      const url = "https://www.dropbox.com/s/abc123/image.png";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, false);
    });

    it("rejects arbitrary external URLs", () => {
      const url = "https://example.com/image.png";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, false);
    });

    it("rejects other Google domains", () => {
      const url = "https://docs.google.com/document/d/abc123";
      const result = allowedImageUrl.safeParse(url);
      assert.strictEqual(result.success, false);
    });
  });

  describe("rejects invalid inputs", () => {
    it("rejects non-URL strings", () => {
      const result = allowedImageUrl.safeParse("not-a-url");
      assert.strictEqual(result.success, false);
    });

    it("rejects empty strings", () => {
      const result = allowedImageUrl.safeParse("");
      assert.strictEqual(result.success, false);
    });

    it("rejects URLs over 500 characters", () => {
      const longUrl = `https://rytsziwekhtjdqzzpdso.supabase.co/${"a".repeat(500)}`;
      const result = allowedImageUrl.safeParse(longUrl);
      assert.strictEqual(result.success, false);
    });
  });

  it("ALLOWED_IMAGE_HOSTS matches next.config.mjs remotePatterns", () => {
    // These must stay in sync with next.config.mjs images.remotePatterns
    const expectedHosts = [
      "lh3.googleusercontent.com",
      "avatars.githubusercontent.com",
      "rytsziwekhtjdqzzpdso.supabase.co",
      "media.licdn.com",
    ];
    assert.deepStrictEqual([...ALLOWED_IMAGE_HOSTS], expectedHosts);
  });
});
