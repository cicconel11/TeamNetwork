import type { SupabaseClient } from "@supabase/supabase-js";

const SIGNED_URL_EXPIRY = 3600;
const BUCKET = "org-media";

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

  const entries = await Promise.all(
    media.map(async (m) => {
      const previewUrl = await signStoragePath(
        serviceClient,
        m.preview_storage_path ?? m.storage_path,
      );
      return [m.id, { thumbnailUrl: previewUrl }] as const;
    }),
  );

  for (const [id, urls] of entries) {
    results.set(id, urls);
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

  const entries = await Promise.all(
    media.map(async (m) => {
      const isVideo = m.media_type === "video" || m.mime_type.startsWith("video/");
      if (isVideo) {
        return [m.id, { thumbnailUrl: null }] as const;
      }

      const previewUrl = await signStoragePath(
        serviceClient,
        m.preview_storage_path ?? m.storage_path,
      );

      return [m.id, { thumbnailUrl: previewUrl }] as const;
    }),
  );

  for (const [id, urls] of entries) {
    results.set(id, urls);
  }

  return results;
}
