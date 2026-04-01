import { createServiceClient } from "@/lib/supabase/service";

interface MediaDeleteActor {
  isAdmin: boolean;
  userId: string;
}

interface SoftDeleteMediaItemsOptions {
  orgId: string;
  mediaIds: string[];
  actor: MediaDeleteActor;
  forbiddenMessage: string;
  now?: string;
}

interface SoftDeleteMediaItemsSuccess {
  ok: true;
  deletedIds: string[];
}

interface SoftDeleteMediaItemsFailure {
  ok: false;
  status: 403 | 500;
  error: string;
}

export type SoftDeleteMediaItemsResult =
  | SoftDeleteMediaItemsSuccess
  | SoftDeleteMediaItemsFailure;

export async function softDeleteMediaItems(
  serviceClient: ReturnType<typeof createServiceClient>,
  options: SoftDeleteMediaItemsOptions,
): Promise<SoftDeleteMediaItemsResult> {
  const { orgId, actor, forbiddenMessage } = options;
  const mediaIds = Array.from(new Set(options.mediaIds));
  const now = options.now ?? new Date().toISOString();

  if (mediaIds.length === 0) {
    return { ok: true, deletedIds: [] };
  }

  if (!actor.isAdmin) {
    const { data: items, error: fetchError } = await serviceClient
      .from("media_items")
      .select("id, uploaded_by")
      .in("id", mediaIds)
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    if (fetchError) {
      return { ok: false, status: 500, error: "Failed to verify ownership" };
    }

    const allOwned =
      (items || []).length === mediaIds.length &&
      (items || []).every((item) => item.uploaded_by === actor.userId);

    if (!allOwned) {
      return { ok: false, status: 403, error: forbiddenMessage };
    }
  }

  const { error: clearCoverError } = await serviceClient
    .from("media_albums")
    .update({ cover_media_id: null, updated_at: now })
    .eq("organization_id", orgId)
    .in("cover_media_id", mediaIds)
    .is("deleted_at", null);

  if (clearCoverError) {
    console.error("[media/delete-media] Failed to clear album covers:", clearCoverError);
    return { ok: false, status: 500, error: "Failed to clear album covers" };
  }

  const { data, error: deleteError } = await serviceClient
    .from("media_items")
    .update({ deleted_at: now })
    .eq("organization_id", orgId)
    .in("id", mediaIds)
    .is("deleted_at", null)
    .select("id");

  if (deleteError) {
    console.error("[media/delete-media] Soft delete failed:", deleteError);
    return { ok: false, status: 500, error: "Failed to delete media items" };
  }

  return {
    ok: true,
    deletedIds: (data ?? []).map((row) => row.id as string),
  };
}
