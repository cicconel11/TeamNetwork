import test from "node:test";
import assert from "node:assert/strict";
import {
  getFolderAlbumBatchStatus,
  getGalleryRetryProgress,
  getGalleryUploadMode,
  summarizeFolderAlbumBatch,
} from "@/lib/media/gallery-upload-flow";

test("retry resumes album association without re-uploading once media finalization already succeeded", () => {
  assert.equal(
    getGalleryUploadMode({
      mediaId: "media-1",
      targetAlbumId: "album-1",
      uploadFinalized: true,
    }),
    "associate-only",
  );
});

test("upload flow performs a full upload when media has not finished finalizing", () => {
  assert.equal(
    getGalleryUploadMode({
      mediaId: "media-1",
      targetAlbumId: "album-1",
      uploadFinalized: false,
    }),
    "upload",
  );
});

test("retry progress stays at 100 percent when only album association remains", () => {
  assert.equal(getGalleryRetryProgress(true), 100);
  assert.equal(getGalleryRetryProgress(false), 0);
});

test("folder album summary tracks successful, failed, and unattached media ids", () => {
  const summary = summarizeFolderAlbumBatch([
    { id: "file-1", status: "done", mediaId: "media-1" },
    { id: "file-2", status: "error", mediaId: null },
    { id: "file-3", status: "done", mediaId: "media-3" },
  ], ["media-1"]);

  assert.deepEqual(summary.completedMediaIds, ["media-1", "media-3"]);
  assert.deepEqual(summary.failedFileIds, ["file-2"]);
  assert.deepEqual(summary.pendingMediaIds, ["media-3"]);
  assert.equal(summary.allSettled, true);
  assert.equal(summary.hasSuccessfulUploads, true);
  assert.equal(summary.hasFailures, true);
});

test("folder album status stays waiting while uploads are still in flight", () => {
  const summary = summarizeFolderAlbumBatch([
    { id: "file-1", status: "uploading", mediaId: null },
    { id: "file-2", status: "done", mediaId: "media-2" },
  ]);

  assert.equal(getFolderAlbumBatchStatus(summary, "album-1"), "waiting_for_uploads");
});

test("folder album status fails when every file has settled and none succeeded", () => {
  const summary = summarizeFolderAlbumBatch([
    { id: "file-1", status: "error", mediaId: null },
    { id: "file-2", status: "error", mediaId: null },
  ]);

  assert.equal(getFolderAlbumBatchStatus(summary, null), "failed");
});

test("folder album status is partial success after attaching all successful uploads when some files failed", () => {
  const summary = summarizeFolderAlbumBatch([
    { id: "file-1", status: "done", mediaId: "media-1" },
    { id: "file-2", status: "error", mediaId: null },
  ], ["media-1"]);

  assert.equal(getFolderAlbumBatchStatus(summary, "album-1"), "partial_success");
});

test("folder album status is success after attaching all successful uploads when no files failed", () => {
  const summary = summarizeFolderAlbumBatch([
    { id: "file-1", status: "done", mediaId: "media-1" },
    { id: "file-2", status: "done", mediaId: "media-2" },
  ], ["media-1", "media-2"]);

  assert.equal(getFolderAlbumBatchStatus(summary, "album-1"), "success");
});
