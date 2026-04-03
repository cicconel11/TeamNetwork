import test from "node:test";
import assert from "node:assert/strict";
import {
  BulkDeletePartialError,
  bulkDeleteSelectedMedia,
  chunkBulkDeleteMediaIds,
  getBulkDeletePartialFailureMessage,
  getBulkDeleteSuccessMessage,
  MEDIA_BULK_DELETE_BATCH_SIZE,
} from "@/lib/media/delete-media-client";
import {
  canDeleteAllMediaItems,
  canDeleteMediaItem,
  filterBulkDeleteSelection,
  getBulkDeleteEligibleIds,
} from "@/lib/media/delete-selection";

function createIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `media-${index + 1}`);
}

test("bulkDeleteSelectedMedia returns early for an empty selection", async () => {
  let calls = 0;

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: [],
    fetchImpl: async () => {
      calls += 1;
      return new Response();
    },
  });

  assert.deepEqual(result.deletedIds, []);
  assert.equal(result.deletedCount, 0);
  assert.equal(calls, 0);
});

test("bulkDeleteSelectedMedia batches requests and aggregates deleted ids", async () => {
  const ids = createIds(150);
  const chunks: string[][] = [];

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: ids,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { mediaIds: string[] };
      chunks.push(body.mediaIds);
      return Response.json({ deletedIds: body.mediaIds });
    },
  });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 100);
  assert.equal(chunks[1].length, 50);
  assert.deepEqual(result.deletedIds, ids);
  assert.equal(result.deletedCount, 150);
});

test("bulkDeleteSelectedMedia preserves earlier successes when a later chunk fails", async () => {
  const ids = createIds(102);
  let callCount = 0;

  await assert.rejects(
    () =>
      bulkDeleteSelectedMedia({
        orgId: "org-1",
        mediaIds: ids,
        fetchImpl: async (_input, init) => {
          callCount += 1;
          const body = JSON.parse(String(init?.body)) as { mediaIds: string[] };

          if (callCount === 1) {
            return Response.json({ deletedIds: body.mediaIds });
          }

          return Response.json({ error: "Chunk failed" }, { status: 500 });
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof BulkDeletePartialError);
      assert.equal(error.message, "Chunk failed");
      assert.deepEqual(error.deletedIds, ids.slice(0, 100));
      assert.deepEqual(error.failedIds, ids.slice(100));
      return true;
    },
  );
});

test("bulk delete messages describe full and partial results", () => {
  assert.equal(getBulkDeleteSuccessMessage(1), "Deleted 1 item");
  assert.equal(getBulkDeleteSuccessMessage(3), "Deleted 3 items");
  assert.equal(getBulkDeletePartialFailureMessage(2, 5), "Deleted 2 items; 5 failed");
});

test("non-admin gallery bulk delete only allows the user's own uploads", () => {
  const items = [
    { id: "media-1", uploaded_by: "user-1" },
    { id: "media-2", uploaded_by: "user-2" },
  ];

  assert.equal(canDeleteMediaItem(items[0], { isAdmin: false, currentUserId: "user-1" }), true);
  assert.equal(canDeleteMediaItem(items[1], { isAdmin: false, currentUserId: "user-1" }), false);
  assert.deepEqual(
    getBulkDeleteEligibleIds(items, { isAdmin: false, currentUserId: "user-1" }),
    ["media-1"],
  );
  assert.deepEqual(
    filterBulkDeleteSelection(items, ["media-1", "media-2"], { isAdmin: false, currentUserId: "user-1" }),
    ["media-1"],
  );
  assert.equal(canDeleteAllMediaItems(items, { isAdmin: false, currentUserId: "user-1" }), false);
});

test("admins can bulk delete every visible upload", () => {
  const items = [
    { id: "media-1", uploaded_by: "user-1" },
    { id: "media-2", uploaded_by: "user-2" },
  ];

  assert.deepEqual(
    getBulkDeleteEligibleIds(items, { isAdmin: true }),
    ["media-1", "media-2"],
  );
  assert.equal(canDeleteAllMediaItems(items, { isAdmin: true }), true);
});

test("bulk delete client chunks large selections into 100-item requests", () => {
  const mediaIds = Array.from(
    { length: MEDIA_BULK_DELETE_BATCH_SIZE * 2 + 5 },
    (_, index) => `media-${index + 1}`,
  );

  assert.deepEqual(
    chunkBulkDeleteMediaIds(mediaIds).map((chunk) => chunk.length),
    [100, 100, 5],
  );
});

test("bulk delete client aggregates batched responses", async () => {
  const calls: string[][] = [];
  const fetchImpl: typeof fetch = (async (_input, init) => {
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { mediaIds: string[] };
    calls.push(parsed.mediaIds);

    return {
      ok: true,
      json: async () => ({ deletedIds: parsed.mediaIds }),
    } as Response;
  }) as typeof fetch;

  const result = await bulkDeleteSelectedMedia({
    orgId: "org-1",
    mediaIds: Array.from({ length: 205 }, (_, index) => `media-${index + 1}`),
    fetchImpl,
  });

  assert.deepEqual(calls.map((chunk) => chunk.length), [100, 100, 5]);
  assert.equal(result.deletedCount, 205);
  assert.equal(result.deletedIds[0], "media-1");
  assert.equal(result.deletedIds.at(-1), "media-205");
});
