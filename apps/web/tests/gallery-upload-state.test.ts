import test from "node:test";
import assert from "node:assert/strict";
import {
  galleryUploadReducer,
  prepareGalleryUploadEntries,
  type UploadFileEntry,
} from "@/hooks/useGalleryUpload";
import type { PreparedImageUpload } from "@/lib/media/image-preparation";

function makeEntry(id: string, overrides: Partial<UploadFileEntry> = {}): UploadFileEntry {
  return {
    id,
    file: null,
    previewFile: null,
    fileName: `${id}.jpg`,
    fileSize: 1234,
    previewFileSize: 321,
    mimeType: "image/jpeg",
    previewMimeType: "image/jpeg",
    previewUrl: null,
    title: id,
    description: "",
    tags: [],
    takenAt: "",
    status: "queued",
    progress: 0,
    error: null,
    retryCount: 0,
    mediaId: null,
    uploadFinalized: false,
    originalName: `${id}.jpg`,
    originalSize: 1234,
    ...overrides,
  };
}

/**
 * Helper: stub `prepareImageUpload` that:
 *   - shrinks `bytes` to `compressedBytes`
 *   - renames `.jpeg`/`.jpg` to `.jpg` (matching real prep behavior)
 *   - keeps the rest as no-op stubs.
 */
function makePrepStub(compressedBytes: number) {
  return async (file: File): Promise<PreparedImageUpload> => {
    const renamed = file.name.replace(/\.jpeg$/i, ".jpg");
    const compressed = new File([new Uint8Array(compressedBytes)], renamed, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    const previewFile = new File([new Uint8Array(8_000)], `preview-${renamed}`, {
      type: "image/jpeg",
    });
    return {
      file: compressed,
      previewFile,
      previewUrl: "blob:fake-preview",
      mimeType: "image/jpeg",
      previewMimeType: "image/jpeg",
      originalBytes: file.size,
      normalizedBytes: compressedBytes,
    };
  };
}

function bigJpeg(bytes: number, name = "IMG_0001.jpeg"): File {
  const f = new File([new Uint8Array(0)], name, { type: "image/jpeg" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

test("replacing files for a new folder batch discards prior queue entries and completed media ids", () => {
  const prevState = {
    files: [
      makeEntry("old-1", { status: "done", mediaId: "media-old-1", uploadFinalized: true, progress: 100 }),
      makeEntry("old-2", { status: "error", error: "Upload failed" }),
    ],
    completedMediaIds: ["media-old-1"],
    pendingAlbumName: "Old Folder",
  };

  const nextState = galleryUploadReducer(prevState, {
    type: "ADD_FILES",
    replaceExisting: true,
    entries: [makeEntry("new-1"), makeEntry("new-2")],
  });

  assert.deepEqual(nextState.files.map((file) => file.id), ["new-1", "new-2"]);
  assert.deepEqual(nextState.completedMediaIds, []);
  assert.equal(nextState.pendingAlbumName, "Old Folder");
});

test("clearing all uploads resets the queue, album name, and completed media ids", () => {
  const prevState = {
    files: [makeEntry("file-1", { status: "done", mediaId: "media-1" })],
    completedMediaIds: ["media-1"],
    pendingAlbumName: "Spring Game",
  };

  const nextState = galleryUploadReducer(prevState, { type: "CLEAR_ALL" });

  assert.deepEqual(nextState, {
    files: [],
    completedMediaIds: [],
    pendingAlbumName: null,
  });
});

test("prepareGalleryUploadEntries accepts a 14 MB JPEG that compresses below the cap", async () => {
  const file = bigJpeg(14 * 1024 * 1024);
  const { entries, rejected } = await prepareGalleryUploadEntries({
    files: [file],
    existingEntries: [],
    prepareImage: makePrepStub(600_000),
  });

  assert.deepEqual(rejected, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fileSize, 600_000);
  assert.equal(entries[0].originalName, "IMG_0001.jpeg");
  assert.equal(entries[0].originalSize, 14 * 1024 * 1024);
  // Prepared filename was renamed .jpeg -> .jpg
  assert.equal(entries[0].fileName, "IMG_0001.jpg");
});

test("prepareGalleryUploadEntries rejects a JPEG that stays above the cap after prep", async () => {
  const file = bigJpeg(20 * 1024 * 1024, "huge.jpeg");
  const { entries, rejected } = await prepareGalleryUploadEntries({
    files: [file],
    existingEntries: [],
    // Prep still yields 11 MB (e.g., panoramic or already-compressed source)
    prepareImage: makePrepStub(11 * 1024 * 1024),
  });

  assert.deepEqual(entries, []);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].name, "huge.jpeg");
  assert.equal(rejected[0].error, "Images must be under 10 MB.");
});

test("prepareGalleryUploadEntries dedupes across addFiles calls using raw name/size (ignoring .jpeg→.jpg rename)", async () => {
  const first = bigJpeg(14 * 1024 * 1024, "shared.jpeg");
  const prep = makePrepStub(600_000);

  const { entries: firstEntries } = await prepareGalleryUploadEntries({
    files: [first],
    existingEntries: [],
    prepareImage: prep,
  });
  assert.equal(firstEntries.length, 1);

  // Second call — same raw file again. existingEntries is built from the
  // previously-accepted entry's originalName/originalSize.
  const existingEntries = firstEntries.map((e) => ({
    name: e.originalName,
    size: e.originalSize,
  }));

  const duplicate = bigJpeg(14 * 1024 * 1024, "shared.jpeg");
  const { entries: secondEntries, rejected } = await prepareGalleryUploadEntries({
    files: [duplicate],
    existingEntries,
    prepareImage: prep,
  });

  assert.deepEqual(secondEntries, []);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].name, "shared.jpeg");
  assert.equal(rejected[0].error, "File already in queue.");
});

test("prepareGalleryUploadEntries rejects HEIC at raw-time without invoking prep", async () => {
  const heic = new File(["heic"], "photo.heic", { type: "image/heic" });
  let prepCalled = false;
  const { entries, rejected } = await prepareGalleryUploadEntries({
    files: [heic],
    existingEntries: [],
    prepareImage: async (f) => {
      prepCalled = true;
      return makePrepStub(1000)(f);
    },
  });

  assert.deepEqual(entries, []);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].error, /HEIC/);
  assert.equal(prepCalled, false);
});
