import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_CONSTRAINTS, type MediaFeature } from "./constants";

/**
 * Links finalized media uploads to a newly created entity.
 * Validates ownership, org, status, and attachment count.
 *
 * Returns { linked: number } on success, or { error: string } on failure.
 */
export async function linkMediaToEntity(
  serviceClient: SupabaseClient,
  opts: {
    mediaIds: string[];
    entityType: MediaFeature;
    entityId: string;
    orgId: string;
    userId: string;
  },
): Promise<{ linked: number; error?: undefined } | { error: string; linked?: undefined }> {
  if (opts.mediaIds.length === 0) {
    return { linked: 0 };
  }

  const constraints = MEDIA_CONSTRAINTS[opts.entityType];
  if (opts.mediaIds.length > constraints.maxAttachments) {
    return {
      error: `Maximum ${constraints.maxAttachments} attachment(s) allowed for ${opts.entityType.replace("_", " ")}`,
    };
  }

  // Fetch all referenced media records
  const { data: records, error: fetchError } = await serviceClient
    .from("media_uploads")
    .select("id, uploader_id, organization_id, status")
    .in("id", opts.mediaIds)
    .is("deleted_at", null);

  if (fetchError) {
    return { error: "Failed to validate media uploads" };
  }

  if (!records || records.length !== opts.mediaIds.length) {
    return { error: "One or more media uploads not found" };
  }

  // Validate each record
  for (const record of records) {
    if (record.uploader_id !== opts.userId) {
      return { error: "Cannot attach media uploaded by another user" };
    }
    if (record.organization_id !== opts.orgId) {
      return { error: "Media does not belong to this organization" };
    }
    if (record.status !== "ready") {
      return { error: `Media ${record.id} is not ready (status: ${record.status})` };
    }
  }

  // Link all media to the entity
  const { error: updateError, count } = await serviceClient
    .from("media_uploads")
    .update({
      entity_type: opts.entityType,
      entity_id: opts.entityId,
    })
    .in("id", opts.mediaIds)
    .eq("status", "ready");

  if (updateError) {
    return { error: "Failed to link media to entity" };
  }

  return { linked: count ?? opts.mediaIds.length };
}
