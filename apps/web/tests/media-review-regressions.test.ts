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

test("media GET routes apply private cache headers only on success paths", () => {
  const urlsSource = readSource("src/lib/media/urls.ts");
  const listRoute = readSource("src/app/api/media/route.ts");
  const detailRoute = readSource("src/app/api/media/[mediaId]/route.ts");
  const albumsRoute = readSource("src/app/api/media/albums/route.ts");
  const albumRoute = readSource("src/app/api/media/albums/[albumId]/route.ts");
  const reorderRoute = readSource("src/app/api/media/reorder-dataset/route.ts");

  assert.match(urlsSource, /export const MEDIA_CACHE_HEADERS = \{/);
  assert.match(urlsSource, /export const MEDIA_LIST_CACHE_HEADERS = \{/);
  assert.match(urlsSource, /"Cache-Control": `private, max-age=\$\{Math\.floor\(SIGNED_URL_EXPIRY \/ 12\)\}`/);
  assert.match(urlsSource, /"Cache-Control": "private, max-age=0, must-revalidate"/);
  assert.match(listRoute, /headers: \{ \.\.\.rateLimit\.headers, \.\.\.MEDIA_CACHE_HEADERS \}/);
  assert.match(detailRoute, /headers: \{ \.\.\.rateLimit\.headers, \.\.\.MEDIA_CACHE_HEADERS \}/);
  assert.match(albumsRoute, /headers: \{ \.\.\.rateLimit\.headers, \.\.\.MEDIA_LIST_CACHE_HEADERS \}/);
  assert.match(albumRoute, /headers: \{ \.\.\.rateLimit\.headers, \.\.\.MEDIA_LIST_CACHE_HEADERS \}/);
  assert.match(reorderRoute, /headers: \{ \.\.\.rateLimit\.headers, \.\.\.MEDIA_CACHE_HEADERS \}/);
});

test("feed post images use the Next.js optimizer but composer blob previews stay unoptimized", () => {
  const postMediaSource = readSource("src/components/feed/PostMedia.tsx");
  const feedComposerSource = readSource("src/components/feed/FeedComposer.tsx");

  assert.doesNotMatch(postMediaSource, /unoptimized/);
  assert.match(feedComposerSource, /unoptimized/);
});

test("signout clears browser cache and cookies", () => {
  const signoutSource = readSource("src/app/auth/signout/route.ts");

  assert.match(signoutSource, /response\.headers\.set\("Clear-Site-Data", "\\"cache\\", \\"cookies\\""\)/);
});

test("status-cast RPC migration restores execute grants for both overloads", () => {
  const migration = readSource("supabase/migrations/20260810000000_fix_media_gallery_upload_rpc_status_cast.sql");
  const normalized = squishWhitespace(migration);

  assert.match(migration, /ALTER FUNCTION public\.create_media_gallery_upload\(/);
  assert.ok(
    normalized.includes("REVOKE EXECUTE ON FUNCTION public.create_media_gallery_upload( uuid, uuid, text, text, text, bigint, text, text, text, text[], timestamptz, text ) FROM PUBLIC, anon, authenticated;"),
    "status-cast migration should revoke execute on the 12-parameter overload before re-granting",
  );
  assert.ok(
    normalized.includes("GRANT EXECUTE ON FUNCTION public.create_media_gallery_upload( uuid, uuid, text, text, text, bigint, text, text, text, text[], timestamptz, text ) TO service_role;"),
    "status-cast migration should grant execute on the 12-parameter overload to service_role",
  );
  assert.ok(
    normalized.includes("REVOKE EXECUTE ON FUNCTION public.create_media_gallery_upload( uuid, uuid, text, text, text, text, bigint, text, text, text, text[], timestamptz, text ) FROM PUBLIC, anon, authenticated;"),
    "status-cast migration should revoke execute on the 13-parameter overload before re-granting",
  );
  assert.ok(
    normalized.includes("GRANT EXECUTE ON FUNCTION public.create_media_gallery_upload( uuid, uuid, text, text, text, text, bigint, text, text, text, text[], timestamptz, text ) TO service_role;"),
    "status-cast migration should grant execute on the 13-parameter overload to service_role",
  );
});
