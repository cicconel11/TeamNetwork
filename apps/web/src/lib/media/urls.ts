import type { SupabaseClient } from "@supabase/supabase-js";
import { isImageMimeType } from "./constants";

const SIGNED_URL_EXPIRY = 3600; // 1 hour
const BUCKET = "org-media";

type MediaUrlResult = {
  url: string | null;
  thumbnailUrl: string | null;
};

/**
 * Generates a signed download URL for a media file.
 * For images, also generates a thumbnail URL using Supabase Image Transforms.
 */
export async function getMediaUrls(
  serviceClient: SupabaseClient,
  storagePath: string,
  mimeType: string,
): Promise<MediaUrlResult> {
  const { data, error } = await serviceClient.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

  if (error || !data?.signedUrl) {
    return { url: null, thumbnailUrl: null };
  }

  let thumbnailUrl: string | null = null;

  if (isImageMimeType(mimeType)) {
    const { data: thumbData } = await serviceClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY, {
        transform: { width: 200, height: 200, resize: "cover" },
      });
    thumbnailUrl = thumbData?.signedUrl ?? null;
  }

  return {
    url: data.signedUrl,
    thumbnailUrl,
  };
}

/**
 * Batch-generates signed URLs for multiple media records.
 * Returns a map of media ID -> { url, thumbnailUrl }.
 */
export async function batchGetMediaUrls(
  serviceClient: SupabaseClient,
  media: Array<{ id: string; storage_path: string; mime_type: string }>,
): Promise<Map<string, MediaUrlResult>> {
  const results = new Map<string, MediaUrlResult>();

  // Process in parallel
  const entries = await Promise.all(
    media.map(async (m) => {
      const urls = await getMediaUrls(serviceClient, m.storage_path, m.mime_type);
      return [m.id, urls] as const;
    }),
  );

  for (const [id, urls] of entries) {
    results.set(id, urls);
  }

  return results;
}
