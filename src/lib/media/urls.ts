import type { SupabaseClient } from "@supabase/supabase-js";

const SIGNED_URL_EXPIRY = 86400;
const BUCKET = "org-media";

// Keep cached responses comfortably shorter than the signed URL lifetime so
// cached URLs still have substantial validity remaining when reused.
export const MEDIA_CACHE_HEADERS = {
  "Cache-Control": `private, max-age=${Math.floor(SIGNED_URL_EXPIRY / 12)}`,
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

  const images: Array<{ index: number; id: string; path: string }> = [];

  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    const isVideo = m.media_type === "video" || m.mime_type.startsWith("video/");
    if (isVideo) {
      results.set(m.id, { thumbnailUrl: null });
    } else {
      images.push({ index: i, id: m.id, path: m.preview_storage_path ?? m.storage_path });
    }
  }

  if (images.length === 0) return results;

  const paths = images.map((img) => img.path);

  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);

  if (error || !data) {
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
