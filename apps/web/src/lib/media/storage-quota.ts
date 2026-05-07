import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-org storage quota enforcement.
 *
 * Mirrors the accounting in get_media_storage_stats(p_org_id) so the UI usage
 * bar and this enforcer never disagree:
 *  - media_items.file_size_bytes + preview_file_size_bytes for live rows in
 *    ('uploading','pending','approved')
 *  - media_uploads.file_size + preview_file_size for live rows in
 *    ('pending','ready')
 *
 * Fail-closed: if either lookup errors, return ok:false with reason
 * "lookup_failed" so callers return 500 rather than silently allowing the
 * upload past a broken guard.
 *
 * NOTE: this is a TOCTOU check, not a strict atomic cap. Two concurrent
 * uploads can both pass and push the org slightly over. A trigger-maintained
 * counter column is the documented follow-up.
 */

export type StorageQuotaCheck =
  | {
      ok: true;
      usedBytes: number;
      quotaBytes: number | null;
      remainingBytes: number | null;
    }
  | {
      ok: false;
      reason: "over_quota" | "lookup_failed";
      usedBytes: number;
      quotaBytes: number;
    };

const ACTIVE_ITEM_STATUSES = ["uploading", "pending", "approved"] as const;
const ACTIVE_UPLOAD_STATUSES = ["pending", "ready"] as const;

type StorageUsageSnapshot = {
  quotaBytes: number | null;
  usedBytes: number;
  mediaItemsCount: number;
  mediaItemsBytes: number;
  mediaUploadsCount: number;
  mediaUploadsBytes: number;
};

type StorageUsageLookup =
  | {
      ok: true;
      snapshot: StorageUsageSnapshot;
    }
  | {
      ok: false;
      reason: "lookup_failed";
    };

export async function getStorageUsageSnapshot(
  serviceClient: SupabaseClient,
  orgId: string,
): Promise<StorageUsageLookup> {
  const { data: subRow, error: subError } = await serviceClient
    .from("organization_subscriptions")
    .select("media_storage_quota_bytes")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (subError) {
    console.error("[storage-quota] subscription lookup failed:", subError);
    return { ok: false, reason: "lookup_failed" };
  }

  const quotaBytes =
    (subRow as { media_storage_quota_bytes: number | null } | null)
      ?.media_storage_quota_bytes ?? null;

  const [itemsResult, uploadsResult] = await Promise.all([
    serviceClient
      .from("media_items")
      .select("file_size_bytes, preview_file_size_bytes")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("status", ACTIVE_ITEM_STATUSES as unknown as string[]),
    serviceClient
      .from("media_uploads")
      .select("file_size, preview_file_size")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .in("status", ACTIVE_UPLOAD_STATUSES as unknown as string[]),
  ]);

  if (itemsResult.error || uploadsResult.error) {
    console.error("[storage-quota] usage sum failed:", {
      itemsError: itemsResult.error,
      uploadsError: uploadsResult.error,
    });
    return { ok: false, reason: "lookup_failed" };
  }

  const mediaItems = (itemsResult.data || []) as Array<{
    file_size_bytes: number | null;
    preview_file_size_bytes?: number | null;
  }>;
  const mediaUploads = (uploadsResult.data || []) as Array<{
    file_size: number | null;
    preview_file_size?: number | null;
  }>;

  const mediaItemsBytes = mediaItems.reduce(
    (sum, row) => sum + (row.file_size_bytes ?? 0) + (row.preview_file_size_bytes ?? 0),
    0,
  );
  const mediaUploadsBytes = mediaUploads.reduce(
    (sum, row) => sum + (row.file_size ?? 0) + (row.preview_file_size ?? 0),
    0,
  );

  return {
    ok: true,
    snapshot: {
      quotaBytes,
      usedBytes: mediaItemsBytes + mediaUploadsBytes,
      mediaItemsCount: mediaItems.length,
      mediaItemsBytes,
      mediaUploadsCount: mediaUploads.length,
      mediaUploadsBytes,
    },
  };
}

export async function checkStorageQuota(
  serviceClient: SupabaseClient,
  orgId: string,
  incomingBytes: number,
  incomingPreviewBytes = 0,
): Promise<StorageQuotaCheck> {
  const usage = await getStorageUsageSnapshot(serviceClient, orgId);
  if (!usage.ok) {
    return { ok: false, reason: "lookup_failed", usedBytes: 0, quotaBytes: 0 };
  }

  const { quotaBytes, usedBytes } = usage.snapshot;
  const projected = usedBytes + incomingBytes + incomingPreviewBytes;

  if (quotaBytes === null) {
    return { ok: true, usedBytes, quotaBytes: null, remainingBytes: null };
  }

  if (projected > quotaBytes) {
    return { ok: false, reason: "over_quota", usedBytes, quotaBytes };
  }

  return {
    ok: true,
    usedBytes,
    quotaBytes,
    remainingBytes: quotaBytes - usedBytes,
  };
}
