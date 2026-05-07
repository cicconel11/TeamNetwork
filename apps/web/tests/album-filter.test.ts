import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterAlbumsByQuery } from "@/lib/media/album-filter";
import type { MediaAlbum } from "@/components/media/AlbumCard";

function makeAlbum(partial: Partial<MediaAlbum> & { id: string; name: string }): MediaAlbum {
  const now = new Date().toISOString();
  return {
    id: partial.id,
    name: partial.name,
    description: partial.description ?? null,
    item_count: partial.item_count ?? 0,
    created_by: partial.created_by ?? "user",
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
    ...partial,
  };
}

describe("filterAlbumsByQuery", () => {
  const albums: MediaAlbum[] = [
    makeAlbum({ id: "1", name: "Soccer 2024", description: "spring season" }),
    makeAlbum({ id: "2", name: "Banquet", description: "End-of-year photos" }),
    makeAlbum({ id: "3", name: "Practice", description: null }),
  ];

  it("returns all albums for empty query", () => {
    assert.equal(filterAlbumsByQuery(albums, "").length, 3);
    assert.equal(filterAlbumsByQuery(albums, "   ").length, 3);
  });

  it("matches name case-insensitively", () => {
    const r = filterAlbumsByQuery(albums, "SOCCER");
    assert.deepEqual(r.map((a) => a.id), ["1"]);
  });

  it("matches description substring", () => {
    const r = filterAlbumsByQuery(albums, "spring");
    assert.deepEqual(r.map((a) => a.id), ["1"]);
  });

  it("returns empty array on no match", () => {
    assert.equal(filterAlbumsByQuery(albums, "zzz").length, 0);
  });

  it("handles null description without throwing", () => {
    const r = filterAlbumsByQuery(albums, "practice");
    assert.deepEqual(r.map((a) => a.id), ["3"]);
  });
});
