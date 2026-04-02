import test from "node:test";
import assert from "node:assert/strict";
import {
  galleryUploadReducer,
  type UploadFileEntry,
} from "@/hooks/useGalleryUpload";

function makeEntry(id: string, overrides: Partial<UploadFileEntry> = {}): UploadFileEntry {
  return {
    id,
    file: null,
    previewFile: null,
    fileName: `${id}.jpg`,
    fileSize: 1234,
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
    ...overrides,
  };
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
