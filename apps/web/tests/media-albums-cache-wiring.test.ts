import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// These regression tests pin the wiring of the "ghost albums" cache fix.
// Each piece is necessary on its own — if any one is reverted, deleted
// albums reappear from a stale browser cache for up to 2 hours.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

test("GET /api/media/albums responses use list-cache headers, not long-lived MEDIA_CACHE_HEADERS", () => {
  const source = read("src/app/api/media/albums/route.ts");
  assert.ok(
    source.includes("MEDIA_LIST_CACHE_HEADERS"),
    "albums route must import MEDIA_LIST_CACHE_HEADERS",
  );
  // Look only at GET handler region (everything before `export async function POST`).
  const getRegion = source.split("export async function POST")[0];
  assert.ok(
    !getRegion.includes("MEDIA_CACHE_HEADERS"),
    "GET handler must not reference long-cache MEDIA_CACHE_HEADERS — that's what caused ghost albums",
  );
  // And it must actually spread the list headers somewhere in the GET region.
  assert.ok(
    getRegion.includes("MEDIA_LIST_CACHE_HEADERS"),
    "GET handler must spread MEDIA_LIST_CACHE_HEADERS into responses",
  );
});

test("GET /api/media/albums/[albumId] responses use list-cache headers, not long-lived MEDIA_CACHE_HEADERS", () => {
  const source = read("src/app/api/media/albums/[albumId]/route.ts");
  assert.ok(
    source.includes("MEDIA_LIST_CACHE_HEADERS"),
    "album item route must import MEDIA_LIST_CACHE_HEADERS",
  );
  const getRegion = source.split("export async function PATCH")[0];
  assert.ok(
    !getRegion.includes("MEDIA_CACHE_HEADERS"),
    "GET handler must not reference long-cache MEDIA_CACHE_HEADERS or album contents can stay empty after uploads finish",
  );
  assert.ok(
    getRegion.includes("MEDIA_LIST_CACHE_HEADERS"),
    "GET handler must spread MEDIA_LIST_CACHE_HEADERS into responses",
  );
});

test("AlbumGrid fetches with cache: 'no-store' and reacts to refreshToken", () => {
  const source = read("src/components/media/AlbumGrid.tsx");
  // The component must (a) call /api/media/albums and (b) pass cache: "no-store"
  // somewhere in the fetchAlbums callback.
  assert.ok(
    /\/api\/media\/albums\?orgId=/.test(source),
    "AlbumGrid must call /api/media/albums",
  );
  const fetchAlbumsMatch = source.match(/fetchAlbums\s*=\s*useCallback\([\s\S]*?\),\s*\[/);
  assert.ok(fetchAlbumsMatch, "AlbumGrid must define fetchAlbums via useCallback");
  assert.ok(
    /cache:\s*"no-store"/.test(fetchAlbumsMatch![0]),
    "fetchAlbums must pass cache: 'no-store' to bust the browser cache",
  );
  assert.ok(
    source.includes("refreshToken"),
    "AlbumGrid must accept a refreshToken prop",
  );
  assert.ok(
    /useEffect\(\s*\(\)\s*=>\s*\{\s*fetchAlbums\(\);?\s*\}\s*,\s*\[fetchAlbums,\s*refreshToken\]\)/.test(
      source,
    ),
    "AlbumGrid must refetch when refreshToken changes",
  );
});

test("AlbumView fetches album items with cache: 'no-store' so transient empty responses are not reused", () => {
  const source = read("src/components/media/AlbumView.tsx");
  assert.ok(
    source.includes("const fetchItems = useCallback("),
    "AlbumView must define fetchItems via useCallback",
  );
  assert.ok(
    source.includes('cache: "no-store"'),
    "AlbumView fetchItems must pass cache: 'no-store' to avoid stale empty album payloads",
  );
});

test("MediaGallery bumps refreshToken in handleAlbumDeleted and passes it to AlbumGrid", () => {
  const source = read("src/components/media/MediaGallery.tsx");
  assert.ok(
    source.includes("albumRefreshToken"),
    "MediaGallery must own an albumRefreshToken state",
  );
  // Bump must live inside handleAlbumDeleted.
  const handlerMatch = source.match(/handleAlbumDeleted\s*=\s*useCallback\([\s\S]*?\}\s*,\s*\[[^\]]*\]\s*\)/);
  assert.ok(handlerMatch, "handleAlbumDeleted callback must exist");
  assert.ok(
    /setAlbumRefreshToken\(\s*\(\s*t\s*\)\s*=>\s*t\s*\+\s*1\s*\)/.test(handlerMatch![0]),
    "handleAlbumDeleted must increment albumRefreshToken so AlbumGrid refetches",
  );
  assert.ok(
    /<AlbumGrid[\s\S]*?refreshToken=\{albumRefreshToken\}/.test(source),
    "MediaGallery must pass albumRefreshToken into AlbumGrid",
  );
});
