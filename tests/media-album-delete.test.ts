import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canDeleteAlbumAndMedia, resolveAlbumDeleteMode } from "@/lib/media/albums";

function simulateAlbumDelete(params: {
  isAdmin: boolean;
  currentUserId?: string;
  mode?: string | null;
  uploadedBy: string[];
}) {
  const mode = resolveAlbumDeleteMode(params.mode);
  const items = params.uploadedBy.map((uploaded_by, index) => ({ id: `item-${index + 1}`, uploaded_by }));

  if (mode === "album_and_media" && !canDeleteAlbumAndMedia(items, {
    isAdmin: params.isAdmin,
    currentUserId: params.currentUserId,
  })) {
    return { status: 403, error: "forbidden_delete_all" };
  }

  return {
    status: 200,
    mode,
    deletedAlbum: true,
    deletedMediaCount: mode === "album_and_media" ? items.length : 0,
  };
}

test("album-only delete leaves photos in all photos", () => {
  assert.deepEqual(
    simulateAlbumDelete({
      isAdmin: false,
      currentUserId: "user-1",
      mode: "album_only",
      uploadedBy: ["user-1", "user-2"],
    }),
    {
      status: 200,
      mode: "album_only",
      deletedAlbum: true,
      deletedMediaCount: 0,
    },
  );
});

test("delete album and all photos is rejected for non-admins when any item belongs to another uploader", () => {
  assert.deepEqual(
    simulateAlbumDelete({
      isAdmin: false,
      currentUserId: "user-1",
      mode: "album_and_media",
      uploadedBy: ["user-1", "user-2"],
    }),
    {
      status: 403,
      error: "forbidden_delete_all",
    },
  );
});

test("delete album and all photos is allowed for admins", () => {
  assert.deepEqual(
    simulateAlbumDelete({
      isAdmin: true,
      mode: "album_and_media",
      uploadedBy: ["user-1", "user-2"],
    }),
    {
      status: 200,
      mode: "album_and_media",
      deletedAlbum: true,
      deletedMediaCount: 2,
    },
  );
});

test("album delete route supports an explicit delete mode and album view exposes both actions", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/media/albums/[albumId]/route.ts", import.meta.url),
    "utf8",
  );
  const albumViewSource = readFileSync(
    new URL("../src/components/media/AlbumView.tsx", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /searchParams\.get\("mode"\)/);
  assert.match(routeSource, /album_and_media/);
  assert.match(albumViewSource, /Delete album only/);
  assert.match(albumViewSource, /Delete album and all photos/);
});
