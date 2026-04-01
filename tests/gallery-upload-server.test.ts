import test from "node:test";
import assert from "node:assert/strict";
import {
  GALLERY_ALBUM_BATCH_RATE_LIMIT,
  getNextGallerySortOrder,
  isMissingMediaAlbumsDraftColumnError,
  isStaleEmptyUploadDraftAlbum,
  shouldListMediaAlbum,
  withMediaAlbumsDraftColumnFallback,
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

test("draft column fallback detects missing-column errors from postgres and schema cache", () => {
  assert.equal(
    isMissingMediaAlbumsDraftColumnError({
      code: "42703",
      message: 'column media_albums.is_upload_draft does not exist',
    }),
    true,
  );

  assert.equal(
    isMissingMediaAlbumsDraftColumnError({
      code: "PGRST204",
      message: "Could not find the 'is_upload_draft' column of 'media_albums' in the schema cache",
    }),
    true,
  );

  assert.equal(
    isMissingMediaAlbumsDraftColumnError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    false,
  );
});

test("draft column fallback retries a query without the draft column when needed", async () => {
  let fallbackCalls = 0;

  const result = await withMediaAlbumsDraftColumnFallback({
    withDraftColumn: async () => ({
      data: null,
      error: {
        code: "42703",
        message: 'column media_albums.is_upload_draft does not exist',
      },
    }),
    withoutDraftColumn: async () => {
      fallbackCalls += 1;
      return {
        data: [{ id: "album-1", name: "Spring" }],
        error: null,
      };
    },
  });

  assert.equal(fallbackCalls, 1);
  assert.equal(result.usedDraftColumn, false);
  assert.deepEqual(result.data, [{ id: "album-1", name: "Spring" }]);
  assert.equal(result.error, null);
});

test("draft column fallback does not retry for unrelated errors", async () => {
  let fallbackCalls = 0;

  const result = await withMediaAlbumsDraftColumnFallback({
    withDraftColumn: async () => ({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table media_albums",
      },
    }),
    withoutDraftColumn: async () => {
      fallbackCalls += 1;
      return { data: null, error: null };
    },
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.usedDraftColumn, true);
  assert.equal(result.data, null);
  assert.deepEqual(result.error, {
    code: "42501",
    message: "permission denied for table media_albums",
  });
});
