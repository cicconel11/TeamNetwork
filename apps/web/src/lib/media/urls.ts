import type { SupabaseClient } from "@supabase/supabase-js";

// 24-hour signed URLs + 2-hour browser cache reduce storage egress significantly.
// Tradeoff: a revoked member or moderated image stays accessible via cached/signed
// URLs for up to 24h. Acceptable because auth is checked at the API layer before
// URLs are issued, and the bucket is private (not publicly accessible).
const SIGNED_URL_EXPIRY = 86400;
const BUCKET = "org-media";

// Keep cached responses comfortably shorter than the signed URL lifetime so
// cached URLs still have substantial validity remaining when reused.
export const MEDIA_CACHE_HEADERS = {
  "Cache-Control": `private, max-age=${Math.floor(SIGNED_URL_EXPIRY / 12)}`,
} as const;

// Album/list payloads are tiny and must be fresh — long browser caching here
// caused "ghost albums" after a delete because the stale list kept rendering.
// Item-level routes that embed signed URLs continue to use MEDIA_CACHE_HEADERS.
export const MEDIA_LIST_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=0, must-revalidate",
} as const;

export type MediaUrlResult = {
  originalUrl: string | null;
  previewUrl: string | null;
};

export type GridPreviewUrlResult = {
  thumbnailUrl: string | null;
};

async function signStoragePath(
  serviceClient: SupabaseClient,
  storagePath: string | null | undefined,
): Promise<string | null> {
  if (!storagePath) return null;

  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function getMediaUrls(
  serviceClient: SupabaseClient,
  storagePath: string,
  previewStoragePath?: string | null,
): Promise<MediaUrlResult> {
  const [originalUrl, previewUrl] = await Promise.all([
    signStoragePath(serviceClient, storagePath),
    signStoragePath(serviceClient, previewStoragePath ?? storagePath),
  ]);

  return {
    originalUrl,
    previewUrl,
  };
}

export async function batchGetMediaBrowseUrls(
  serviceClient: SupabaseClient,
  media: Array<{ id: string; storage_path: string; preview_storage_path?: string | null }>,
): Promise<Map<string, GridPreviewUrlResult>> {
  const results = new Map<string, GridPreviewUrlResult>();

  if (media.length === 0) return results;

  const paths = media.map((m) => m.preview_storage_path ?? m.storage_path);

  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);

  if (error || !data) {
    console.error("createSignedUrls failed (browse):", error?.message);
    for (const m of media) {
      results.set(m.id, { thumbnailUrl: null });
    }
    return results;
  }

  for (let i = 0; i < media.length; i++) {
    const item = data[i];
    const url = item?.error ? null : (item?.signedUrl ?? null);
    results.set(media[i].id, { thumbnailUrl: url });
  }

  return results;
}

export async function batchGetGridPreviewUrls(
  serviceClient: SupabaseClient,
  media: Array<{
    id: string;
    storage_path: string;
    preview_storage_path?: string | null;
    mime_type: string;
    media_type?: "image" | "video";
  }>,
): Promise<Map<string, GridPreviewUrlResult>> {
  const results = new Map<string, GridPreviewUrlResult>();

  const images: Array<{ id: string; path: string }> = [];

  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    const isVideo = m.media_type === "video" || m.mime_type.startsWith("video/");
    if (isVideo) {
      results.set(m.id, { thumbnailUrl: null });
    } else {
      images.push({ id: m.id, path: m.preview_storage_path ?? m.storage_path });
    }
  }

  if (images.length === 0) return results;

  const paths = images.map((img) => img.path);

  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);

  if (error || !data) {
    console.error("createSignedUrls failed (grid):", error?.message);
    for (const img of images) {
      results.set(img.id, { thumbnailUrl: null });
    }
    return results;
  }

  for (let i = 0; i < images.length; i++) {
    const item = data[i];
    const url = item?.error ? null : (item?.signedUrl ?? null);
    results.set(images[i].id, { thumbnailUrl: url });
  }

  return results;
}
