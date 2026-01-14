import type { SupabaseClient } from "@supabase/supabase-js";
import { batchGetMediaUrls } from "./urls";
import type { MediaFeature } from "./constants";

export type MediaAttachment = {
  id: string;
  url: string | null;
  thumbnailUrl: string | null;
  mimeType: string;
  fileSize: number | null;
  fileName: string;
};

/**
 * Batch-fetches media attachments for a set of entities.
 * Returns a map of entityId -> MediaAttachment[].
 *
 * Uses a single query to avoid N+1, then generates signed URLs in parallel.
 */
export async function fetchMediaForEntities(
  serviceClient: SupabaseClient,
  entityType: MediaFeature,
  entityIds: string[],
): Promise<Map<string, MediaAttachment[]>> {
  const result = new Map<string, MediaAttachment[]>();

  if (entityIds.length === 0) return result;

  // Single query for all media across entities
  const { data: mediaRows, error } = await serviceClient
    .from("media_uploads")
    .select("id, entity_id, storage_path, mime_type, file_size, file_name")
    .eq("entity_type", entityType)
    .in("entity_id", entityIds)
    .eq("status", "ready")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error || !mediaRows || mediaRows.length === 0) {
    return result;
  }

  // Generate signed URLs in batch
  const urlMap = await batchGetMediaUrls(serviceClient, mediaRows);

  // Group by entity_id
  for (const row of mediaRows) {
    const urls = urlMap.get(row.id) ?? { url: null, thumbnailUrl: null };
    const attachment: MediaAttachment = {
      id: row.id,
      url: urls.url,
      thumbnailUrl: urls.thumbnailUrl,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      fileName: row.file_name,
    };

    const entityId = row.entity_id!;
    const existing = result.get(entityId);
    if (existing) {
      existing.push(attachment);
    } else {
      result.set(entityId, [attachment]);
    }
  }

  return result;
}
