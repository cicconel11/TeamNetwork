import {
  buildCacheBustedUrl,
  buildTimestampedUploadPath,
  readBlobFromUri,
  uploadToSignedUrl,
  uploadToStorage,
  validateFileSize,
  validateMimeType,
} from "@/lib/uploads";

describe("upload helpers", () => {
  it("validates allowed mime types", () => {
    expect(
      validateMimeType("image/jpeg", ["image/jpeg", "image/png"], "bad mime")
    ).toBeNull();
    expect(
      validateMimeType("video/mp4", ["image/jpeg", "image/png"], "bad mime")
    ).toBe("bad mime");
  });

  it("validates max file size", () => {
    expect(validateFileSize(1024)).toBeNull();
    expect(validateFileSize(10 * 1024 * 1024 + 1)).toBe("File size must be under 10MB");
  });

  it("builds timestamped upload paths", () => {
    expect(buildTimestampedUploadPath("user-1", "avatar.jpg", 123)).toBe(
      "user-1/123_avatar.jpg"
    );
  });

  it("builds cache-busted urls", () => {
    expect(buildCacheBustedUrl("https://cdn.example.com/file.png", 123)).toBe(
      "https://cdn.example.com/file.png?t=123"
    );
    expect(buildCacheBustedUrl("https://cdn.example.com/file.png?size=large", 123)).toBe(
      "https://cdn.example.com/file.png?size=large&t=123"
    );
  });

  it("reads blobs from local uris", async () => {
    const blob = new Blob(["hello"]);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(blob),
    });

    await expect(readBlobFromUri("file://photo.jpg", fetchMock)).resolves.toBe(blob);
    expect(fetchMock).toHaveBeenCalledWith("file://photo.jpg");
  });

  it("throws when reading a local uri fails", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      blob: jest.fn(),
    });

    await expect(readBlobFromUri("file://missing.jpg", fetchMock)).rejects.toThrow(
      "Failed to read local file"
    );
  });

  it("uploads blobs to signed urls", async () => {
    const blob = new Blob(["hello"]);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn(),
    });

    await expect(
      uploadToSignedUrl("https://signed.example.com/upload", blob, "image/jpeg", fetchMock)
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("https://signed.example.com/upload", {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
  });

  it("throws when signed url upload fails", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      blob: jest.fn(),
    });

    await expect(
      uploadToSignedUrl(
        "https://signed.example.com/upload",
        new Blob(["hello"]),
        "image/jpeg",
        fetchMock
      )
    ).rejects.toThrow("Failed to upload file to storage");
  });

  it("uploads to storage buckets", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const storage = {
      from: jest.fn().mockReturnValue({ upload }),
    };

    await expect(
      uploadToStorage({
        storage,
        bucket: "avatars",
        path: "user-1/avatar.jpg",
        body: new Blob(["hello"]),
        contentType: "image/jpeg",
        upsert: true,
      })
    ).resolves.toBeUndefined();

    expect(storage.from).toHaveBeenCalledWith("avatars");
    expect(upload).toHaveBeenCalledWith("user-1/avatar.jpg", expect.any(Blob), {
      contentType: "image/jpeg",
      upsert: true,
    });
  });

  it("throws storage upload errors", async () => {
    const storage = {
      from: jest.fn().mockReturnValue({
        upload: jest.fn().mockResolvedValue({ error: { message: "boom" } }),
      }),
    };

    await expect(
      uploadToStorage({
        storage,
        bucket: "avatars",
        path: "user-1/avatar.jpg",
        body: new Blob(["hello"]),
        contentType: "image/jpeg",
      })
    ).rejects.toThrow("boom");
  });
});
