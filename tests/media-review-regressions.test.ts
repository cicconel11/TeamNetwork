import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function squishWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

test("album item route filters out soft-deleted joined media rows", () => {
  const source = readSource("src/app/api/media/albums/[albumId]/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes('.from("media_album_items")') &&
      normalized.includes('.is("media_items.deleted_at", null)'),
    "album item query should exclude soft-deleted joined media rows",
  );
});

test("folder import appends files without cancelling the current upload queue", () => {
  const source = readSource("src/components/media/MediaUploadPanel.tsx");
  assert.match(source, /const handleFolder = useCallback\(/);
  assert.match(source, /startFolderImport\(folderFiles, folderName\)/);
  assert.doesNotMatch(source, /handleFolder[\s\S]*cancelAll\(/);
});

test("album deletion clears matching import overlays without resetting the whole upload queue", () => {
  const gallerySource = readSource("src/components/media/MediaGallery.tsx");
  const uploadManagerSource = readSource("src/components/media/MediaUploadManagerContext.tsx");
  const albumViewSource = readSource("src/components/media/AlbumView.tsx");
  const dismissImportAlbumBlock = uploadManagerSource.match(
    /const dismissImportAlbum = useCallback\(\(albumId: string\) => \{[\s\S]*?\n  \}, \[clearPendingAlbum, folderAlbum\.album\]\);/,
  )?.[0] ?? "";

  assert.match(albumViewSource, /onAlbumDeleted\(album\.id\)/);
  assert.match(gallerySource, /dismissImportAlbum\(albumId\)/);
  assert.match(gallerySource, /hiddenAlbumIds/);
  assert.ok(dismissImportAlbumBlock.length > 0, "dismissImportAlbum should be defined");
  assert.doesNotMatch(dismissImportAlbumBlock, /cancelAll\(/);
});

test("single media deletes use the shared soft-delete helper and album removals update local counts", () => {
  const singleDeleteRoute = readSource("src/app/api/media/[mediaId]/route.ts");
  const albumViewSource = readSource("src/components/media/AlbumView.tsx");

  assert.match(singleDeleteRoute, /softDeleteMediaItems\(serviceClient, \{/);
  assert.match(albumViewSource, /const albumUpdates = getAlbumUpdatesAfterMediaDelete\(album, \[mediaId\], 1\)/);
  assert.match(albumViewSource, /onAlbumUpdated\?\.\(albumUpdates\)/);
});

test("media upload route uses the transactional gallery upload RPC", () => {
  const source = readSource("src/app/api/media/route.ts");
  const normalized = squishWhitespace(source);

  assert.ok(
    normalized.includes("createMediaGalleryUploadRecord("),
    "media upload route should create rows through the shared upload-record helper",
  );
  assert.equal(
    normalized.includes('rpc("shift_media_gallery_sort_orders"'),
    false,
    "media upload route should no longer reserve gallery order in a separate shift RPC",
  );
});

test("gallery upload RPC migration shifts existing rows and inserts the new item in one function", () => {
  const migration = readSource("supabase/migrations/20260802000001_media_items_gallery_upload_rpc.sql");
  const normalized = squishWhitespace(migration);

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_media_gallery_upload\(/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.ok(
    normalized.includes("UPDATE public.media_items SET gallery_sort_order = gallery_sort_order + 1"),
    "gallery upload RPC should shift existing rows before inserting the new item",
  );
  assert.ok(
    normalized.includes("INSERT INTO public.media_items"),
    "gallery upload RPC should insert the new media row in the same function",
  );
  assert.ok(
    normalized.includes("RETURNING id INTO v_media_id"),
    "gallery upload RPC should return the inserted media id",
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.create_media_gallery_upload[\s\S]*TO service_role;/);
});
