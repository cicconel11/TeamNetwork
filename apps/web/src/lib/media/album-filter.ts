import type { MediaAlbum } from "@/components/media/AlbumCard";

export function filterAlbumsByQuery(albums: MediaAlbum[], query: string): MediaAlbum[] {
  const q = query.trim().toLowerCase();
  if (!q) return albums;
  return albums.filter((a) => {
    const name = a.name?.toLowerCase() ?? "";
    const description = a.description?.toLowerCase() ?? "";
    return name.includes(q) || description.includes(q);
  });
}
