import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOptimisticMediaItem,
  mergeUploadTags,
} from "@/lib/media/gallery-upload-client";
import type { UploadFileEntry } from "@/hooks/useGalleryUpload";

function makeEntry(overrides: Partial<UploadFileEntry> = {}): UploadFileEntry {
  return {
    id: "entry-1",
    file: null,
    previewFile: null,
    fileName: "spring-game.jpg",
    fileSize: 1024,
    mimeType: "image/jpeg",
    previewMimeType: "image/jpeg",
    previewUrl: "blob:preview",
    title: "Spring Game",
    description: "",
    tags: ["team", "action"],
    takenAt: "2026-03-30T12:00:00.000Z",
    status: "done",
    progress: 100,
    error: null,
    retryCount: 0,
    mediaId: "media-1",
    uploadFinalized: true,
    ...overrides,
  };
}

test("completed uploads stay optimistic without requiring a follow-up detail fetch", () => {
  const item = buildOptimisticMediaItem(makeEntry(), "media-1", {
    currentUserId: "user-1",
    isAdmin: false,
    nowIso: "2026-03-31T12:00:00.000Z",
  });

  assert.deepEqual(item, {
    id: "media-1",
    title: "Spring Game",
    description: null,
    media_type: "image",
    url: "blob:preview",
    thumbnail_url: "blob:preview",
    tags: ["team", "action"],
    taken_at: "2026-03-30T12:00:00.000Z",
    created_at: "2026-03-31T12:00:00.000Z",
    uploaded_by: "user-1",
    status: "pending",
  });
});

test("video uploads keep their optimistic preview off the thumbnail field", () => {
  const item = buildOptimisticMediaItem(
    makeEntry({
      fileName: "highlight.mp4",
      mimeType: "video/mp4",
      previewUrl: "blob:video-preview",
    }),
    "media-video-1",
    {
      currentUserId: "user-1",
      isAdmin: true,
      nowIso: "2026-03-31T12:00:00.000Z",
    },
  );

  assert.equal(item.media_type, "video");
  assert.equal(item.url, "blob:video-preview");
  assert.equal(item.thumbnail_url, null);
  assert.equal(item.status, "approved");
});

test("upload tags merge into sorted suggestions without duplicates", () => {
  assert.deepEqual(
    mergeUploadTags(["captain", "team"], ["action", "team", "travel"]),
    ["action", "captain", "team", "travel"],
  );
});
