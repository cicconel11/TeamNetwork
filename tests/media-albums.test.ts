import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteAlbumAndMedia,
  canDeleteMediaFromAlbumView,
  canUploadDirectlyToAlbum,
  getAlbumBulkDeleteEligibleIds,
  getAlbumCoverPickerItems,
  getAlbumCoverValidationError,
  getAlbumUpdatesAfterMediaDelete,
  resolveAlbumDeleteMode,
  shouldExposeAlbumCover,
} from "@/lib/media/albums";

test("album direct upload requires both upload permission and album edit permission", () => {
  assert.equal(canUploadDirectlyToAlbum(true, true), true);
  assert.equal(canUploadDirectlyToAlbum(true, false), false);
  assert.equal(canUploadDirectlyToAlbum(false, true), false);
});

test("non-admin cover picker only includes approved images", () => {
  const items = [
    { id: "approved-image", media_type: "image", status: "approved" },
    { id: "pending-image", media_type: "image", status: "pending" },
    { id: "rejected-image", media_type: "image", status: "rejected" },
    { id: "approved-video", media_type: "video", status: "approved" },
  ];

  assert.deepEqual(
    getAlbumCoverPickerItems(items, false).map((item) => item.id),
    ["approved-image"],
  );
});

test("admin cover picker can use any image regardless of moderation status", () => {
  const items = [
    { id: "approved-image", media_type: "image", status: "approved" },
    { id: "pending-image", media_type: "image", status: "pending" },
    { id: "rejected-image", media_type: "image", status: "rejected" },
    { id: "approved-video", media_type: "video", status: "approved" },
  ];

  assert.deepEqual(
    getAlbumCoverPickerItems(items, true).map((item) => item.id),
    ["approved-image", "pending-image", "rejected-image"],
  );
});

test("album cover validation rejects missing, non-image, and unapproved candidates", () => {
  assert.equal(getAlbumCoverValidationError(null), "Selected cover must belong to this album");
  assert.equal(
    getAlbumCoverValidationError({ media_type: "video", status: "approved" }),
    "Album cover must be an image",
  );
  assert.equal(
    getAlbumCoverValidationError({ media_type: "image", status: "pending" }),
    "Album cover must be approved before it can be used",
  );
  assert.equal(getAlbumCoverValidationError({ media_type: "image", status: "approved" }), null);
});

test("album list only exposes approved covers", () => {
  assert.equal(shouldExposeAlbumCover({ status: "approved" }), true);
  assert.equal(shouldExposeAlbumCover({ status: "pending" }), false);
  assert.equal(shouldExposeAlbumCover({ status: "rejected" }), false);
  assert.equal(shouldExposeAlbumCover(null), false);
});

test("album bulk delete permissions allow admins and item owners only", () => {
  const item = { uploaded_by: "owner-1" };

  assert.equal(canDeleteMediaFromAlbumView(item, { isAdmin: true }), true);
  assert.equal(
    canDeleteMediaFromAlbumView(item, { isAdmin: false, currentUserId: "owner-1" }),
    true,
  );
  assert.equal(
    canDeleteMediaFromAlbumView(item, { isAdmin: false, currentUserId: "other-user" }),
    false,
  );
});

test("album bulk delete eligible ids only includes items the actor can delete", () => {
  const items = [
    { id: "item-1", uploaded_by: "owner-1" },
    { id: "item-2", uploaded_by: "owner-2" },
  ];

  assert.deepEqual(
    getAlbumBulkDeleteEligibleIds(items, { isAdmin: false, currentUserId: "owner-1" }),
    ["item-1"],
  );
  assert.deepEqual(
    getAlbumBulkDeleteEligibleIds(items, { isAdmin: true }),
    ["item-1", "item-2"],
  );
});

test("album delete-all mode is only available when every album item is deletable by the actor", () => {
  const items = [
    { id: "item-1", uploaded_by: "owner-1" },
    { id: "item-2", uploaded_by: "owner-1" },
  ];

  assert.equal(
    canDeleteAlbumAndMedia(items, { isAdmin: false, currentUserId: "owner-1" }),
    true,
  );
  assert.equal(
    canDeleteAlbumAndMedia(
      [...items, { id: "item-3", uploaded_by: "owner-2" }],
      { isAdmin: false, currentUserId: "owner-1" },
    ),
    false,
  );
  assert.equal(canDeleteAlbumAndMedia(items, { isAdmin: true }), true);
});

test("album delete mode defaults safely to album_only", () => {
  assert.equal(resolveAlbumDeleteMode(null), "album_only");
  assert.equal(resolveAlbumDeleteMode("album_only"), "album_only");
  assert.equal(resolveAlbumDeleteMode("album_and_media"), "album_and_media");
  assert.equal(resolveAlbumDeleteMode("unexpected"), "album_only");
});

test("album state clears deleted cover media and decrements item count", () => {
  assert.deepEqual(
    getAlbumUpdatesAfterMediaDelete(
      { cover_media_id: "cover-1", cover_url: "https://example.com/cover.jpg", item_count: 4 },
      ["cover-1", "other-2"],
      2,
    ),
    {
      cover_media_id: null,
      cover_url: null,
      item_count: 2,
    },
  );
});
