import test from "node:test";
import assert from "node:assert/strict";
import {
  GALLERY_ALBUM_BATCH_RATE_LIMIT,
  getNextGallerySortOrder,
  isStaleEmptyUploadDraftAlbum,
  shouldListMediaAlbum,
} from "@/lib/media/gallery-upload-server";

test("album batch rate limits allow large folder uploads", () => {
  assert.deepEqual(GALLERY_ALBUM_BATCH_RATE_LIMIT, {
    limitPerIp: 180,
    limitPerUser: 180,
  });
});

test("new gallery uploads prepend by using the next lowest sort order", () => {
  assert.equal(getNextGallerySortOrder(null), 0);
  assert.equal(getNextGallerySortOrder(0), -1);
  assert.equal(getNextGallerySortOrder(-4), -5);
});

test("album list hides empty upload drafts but keeps normal empty albums visible", () => {
  assert.equal(shouldListMediaAlbum({ is_upload_draft: true, item_count: 0 }), false);
  assert.equal(shouldListMediaAlbum({ is_upload_draft: true, item_count: 1 }), true);
  assert.equal(shouldListMediaAlbum({ is_upload_draft: false, item_count: 0 }), true);
});

test("stale draft album cleanup only targets undeleted empty upload drafts older than the cutoff", () => {
  const cutoff = "2026-03-31T00:00:00.000Z";

  assert.equal(isStaleEmptyUploadDraftAlbum({
    is_upload_draft: true,
    item_count: 0,
    created_at: "2026-03-30T00:00:00.000Z",
    deleted_at: null,
  }, cutoff), true);

  assert.equal(isStaleEmptyUploadDraftAlbum({
    is_upload_draft: true,
    item_count: 2,
    created_at: "2026-03-30T00:00:00.000Z",
    deleted_at: null,
  }, cutoff), false);

  assert.equal(isStaleEmptyUploadDraftAlbum({
    is_upload_draft: false,
    item_count: 0,
    created_at: "2026-03-30T00:00:00.000Z",
    deleted_at: null,
  }, cutoff), false);
});
