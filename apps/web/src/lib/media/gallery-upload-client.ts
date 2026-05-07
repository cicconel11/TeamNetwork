import type { UploadFileEntry } from "@/hooks/useGalleryUpload";

interface OptimisticMediaItem {
  id: string;
  title: string;
  description: string | null;
  media_type: "image" | "video";
  url: string | null;
  thumbnail_url: string | null;
  tags: string[];
  taken_at: string | null;
  created_at: string;
  uploaded_by: string;
  status: "approved" | "pending";
}

export function buildOptimisticMediaItem(
  entry: UploadFileEntry,
  mediaId: string,
  options: {
    currentUserId?: string;
    isAdmin: boolean;
    nowIso?: string;
  },
): OptimisticMediaItem {
  const isVideo = entry.mimeType.startsWith("video/");

  return {
    id: mediaId,
    title: entry.title || entry.fileName,
    description: entry.description || null,
    media_type: isVideo ? "video" : "image",
    url: entry.previewUrl,
    thumbnail_url: isVideo ? null : entry.previewUrl,
    tags: entry.tags,
    taken_at: entry.takenAt ? new Date(entry.takenAt).toISOString() : null,
    created_at: options.nowIso ?? new Date().toISOString(),
    uploaded_by: options.currentUserId || "",
    status: options.isAdmin ? "approved" : "pending",
  };
}

export function mergeUploadTags(existingTags: string[], nextTags: string[]): string[] {
  const merged = new Set(existingTags);
  nextTags.forEach((tag) => merged.add(tag));
  return Array.from(merged).sort();
}
