import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFolderImportAlbum,
  isFolderImportSessionActive,
  mergeFolderImportAlbum,
  type AlbumImportLike,
  type FolderImportFileLike,
} from "@/lib/media/folder-import-session";

function makeAlbum(overrides: Partial<AlbumImportLike> = {}): AlbumImportLike {
  return {
    id: "album-1",
    name: "Spring Trip",
    description: null,
    cover_media_id: null,
    cover_url: null,
    item_count: 0,
    sort_order: 0,
    created_by: "user-1",
    created_at: "2026-03-31T12:00:00.000Z",
    updated_at: "2026-03-31T12:00:00.000Z",
    ...overrides,
  };
}

function makeFile(id: string, overrides: Partial<FolderImportFileLike> = {}): FolderImportFileLike {
  return {
    id,
    status: "queued",
    mediaId: null,
    ...overrides,
  };
}

test("folder imports build an optimistic album that remains visible before the first item attaches", () => {
  const importingAlbum = buildFolderImportAlbum(
    makeAlbum(),
    [
      makeFile("file-1", { status: "done", mediaId: "media-1" }),
      makeFile("file-2", { status: "uploading" }),
    ],
    [],
  );

  assert.deepEqual(importingAlbum, {
    ...makeAlbum(),
    import_status: "waiting_for_uploads",
    import_expected_count: 2,
    import_uploaded_count: 1,
    import_failed_count: 0,
  });
});

test("merging an active folder import overlays progress onto the fetched album list", () => {
  const importingAlbum = {
    ...makeAlbum({ item_count: 2 }),
    import_status: "partial_success" as const,
    import_expected_count: 3,
    import_uploaded_count: 2,
    import_failed_count: 1,
  };

  const merged = mergeFolderImportAlbum(
    [
      makeAlbum({ id: "album-2", name: "Other Album" }),
      makeAlbum({ id: "album-1", name: "Old Name", item_count: 1 }),
    ],
    importingAlbum,
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], importingAlbum);
});

test("deleted albums stay hidden even if a folder import overlay still references them", () => {
  const importingAlbum = makeAlbum({
    id: "album-1",
    item_count: 2,
  });

  const merged = mergeFolderImportAlbum(
    [
      makeAlbum({ id: "album-1", name: "Deleted Album" }),
      makeAlbum({ id: "album-2", name: "Other Album" }),
    ],
    importingAlbum,
    new Set(["album-1"]),
  );

  assert.deepEqual(merged.map((album) => album.id), ["album-2"]);
});

test("closing the panel does not end an active folder import session", () => {
  assert.equal(
    isFolderImportSessionActive("Spring Trip", [makeFile("file-1")], "album-1"),
    true,
  );
  assert.equal(isFolderImportSessionActive(null, [], null), false);
});
