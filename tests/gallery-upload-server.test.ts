import test from "node:test";
import assert from "node:assert/strict";
import {
  createMediaGalleryUploadRecord,
  GALLERY_ALBUM_BATCH_RATE_LIMIT,
  type GalleryUploadRecordClient,
  getNextGallerySortOrder,
  isMissingMediaAlbumsDraftColumnError,
  isMissingCreateMediaGalleryUploadRpcError,
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

test("gallery upload RPC fallback detects missing function errors", () => {
  assert.equal(
    isMissingCreateMediaGalleryUploadRpcError({
      code: "42883",
      message: 'function public.create_media_gallery_upload(uuid, uuid, text) does not exist',
    }),
    true,
  );

  assert.equal(
    isMissingCreateMediaGalleryUploadRpcError({
      code: "PGRST202",
      message: "Could not find the function public.create_media_gallery_upload in the schema cache",
    }),
    true,
  );

  assert.equal(
    isMissingCreateMediaGalleryUploadRpcError({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    false,
  );
});

test("gallery upload record creation uses the RPC result when available", async () => {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

  const client: GalleryUploadRecordClient = {
      rpc: async (fn, params) => {
        rpcCalls.push({ fn, params });
        return { data: "media-rpc-1", error: null };
      },
      from: () => {
        throw new Error("fallback should not be used");
      },
    };

  const result = await createMediaGalleryUploadRecord(
    client,
    {
      orgId: "org-1",
      uploadedBy: "user-1",
      storagePath: "org-1/image/file.jpg",
      fileName: "file.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1234,
      mediaType: "image",
      title: "file",
    },
  );

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "create_media_gallery_upload");
  assert.deepEqual(result, { mediaId: "media-rpc-1", creationPath: "rpc" });
});

test("gallery upload record creation falls back to app-side insert when the RPC is missing", async () => {
  const inserts: Record<string, unknown>[] = [];

  const client: GalleryUploadRecordClient = {
      rpc: async () => ({
        data: null,
        error: {
          code: "42883",
          message: 'function public.create_media_gallery_upload(uuid, uuid, text) does not exist',
        },
      }),
      from: (table: string) => {
        assert.equal(table, "media_items");
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { gallery_sort_order: -4 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "media-fallback-1" },
                  error: null,
                }),
              }),
            };
          },
        };
      },
    };

  const result = await createMediaGalleryUploadRecord(
    client,
    {
      orgId: "org-1",
      uploadedBy: "user-1",
      storagePath: "org-1/image/file.jpg",
      fileName: "file.jpg",
      mimeType: "image/jpeg",
      fileSizeBytes: 1234,
      mediaType: "image",
      title: "file",
      tags: ["spring"],
      status: "uploading",
    },
  );

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].gallery_sort_order, -5);
  assert.deepEqual(result, { mediaId: "media-fallback-1", creationPath: "fallback" });
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
