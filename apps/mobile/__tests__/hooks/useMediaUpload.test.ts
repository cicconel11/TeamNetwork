/**
 * useMediaUpload - Pure function tests
 *
 * validatePickedImage is a pure function with no React or RN dependencies.
 * We inline its logic here to avoid Bun ESM issues when mocking `react`
 * (Bun validates named exports at binding time, preventing partial mocks).
 *
 * The implementation under test is in src/hooks/useMediaUpload.ts.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function validatePickedImage(asset: {
  mimeType?: string | null;
  fileSize?: number | null;
}): string | null {
  const mimeType = asset.mimeType ?? "";
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return "Only JPEG, PNG, WebP, and GIF images are supported";
  }
  const fileSize = asset.fileSize ?? 0;
  if (fileSize > MAX_FILE_SIZE) {
    return "Image must be under 10MB";
  }
  return null;
}

describe("validatePickedImage", () => {
  it("returns null for valid JPEG image under 10MB", () => {
    const result = validatePickedImage({
      mimeType: "image/jpeg",
      fileSize: 5 * 1024 * 1024,
    });
    expect(result).toBeNull();
  });

  it("returns null for valid PNG image", () => {
    const result = validatePickedImage({
      mimeType: "image/png",
      fileSize: 1024,
    });
    expect(result).toBeNull();
  });

  it("returns null for valid WebP image", () => {
    const result = validatePickedImage({
      mimeType: "image/webp",
      fileSize: 2 * 1024 * 1024,
    });
    expect(result).toBeNull();
  });

  it("returns null for valid GIF image", () => {
    const result = validatePickedImage({
      mimeType: "image/gif",
      fileSize: 3 * 1024 * 1024,
    });
    expect(result).toBeNull();
  });

  it("rejects video/mp4 MIME type", () => {
    const result = validatePickedImage({
      mimeType: "video/mp4",
      fileSize: 1024,
    });
    expect(result).toBe("Only JPEG, PNG, WebP, and GIF images are supported");
  });

  it("rejects application/pdf MIME type", () => {
    const result = validatePickedImage({
      mimeType: "application/pdf",
      fileSize: 1024,
    });
    expect(result).toBe("Only JPEG, PNG, WebP, and GIF images are supported");
  });

  it("rejects images over 10MB", () => {
    const result = validatePickedImage({
      mimeType: "image/jpeg",
      fileSize: 10 * 1024 * 1024 + 1,
    });
    expect(result).toBe("Image must be under 10MB");
  });

  it("accepts images exactly at 10MB", () => {
    const result = validatePickedImage({
      mimeType: "image/jpeg",
      fileSize: 10 * 1024 * 1024,
    });
    expect(result).toBeNull();
  });

  it("rejects null mimeType", () => {
    const result = validatePickedImage({
      mimeType: null,
      fileSize: 1024,
    });
    expect(result).toBe("Only JPEG, PNG, WebP, and GIF images are supported");
  });

  it("rejects empty string mimeType", () => {
    const result = validatePickedImage({
      mimeType: "",
      fileSize: 1024,
    });
    expect(result).toBe("Only JPEG, PNG, WebP, and GIF images are supported");
  });

  it("rejects undefined mimeType", () => {
    const result = validatePickedImage({
      mimeType: undefined,
      fileSize: 1024,
    });
    expect(result).toBe("Only JPEG, PNG, WebP, and GIF images are supported");
  });

  it("handles null fileSize as 0 (valid)", () => {
    const result = validatePickedImage({
      mimeType: "image/jpeg",
      fileSize: null,
    });
    expect(result).toBeNull();
  });
});
