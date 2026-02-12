import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getConnectorById } from "./registry";
import type { SyncResult, VendorId } from "./types";
import { debugLog } from "@/lib/debug";

export type SyncOutcome = SyncResult & { ok: boolean; error?: string };

export async function syncScheduleSource(
  supabase: SupabaseClient<Database>,
  input: {
    source: {
      id: string;
      org_id: string;
      vendor_id: string;
      source_url: string;
      connected_user_id?: string | null;
    };
    window: { from: Date; to: Date };
    now?: Date;
  }
): Promise<SyncOutcome> {
  const now = input.now ?? new Date();
  const vendorId = input.source.vendor_id as VendorId;
  const connector = getConnectorById(vendorId);

  if (!connector) {
    const message = `Unsupported vendor: ${input.source.vendor_id}`;
    await supabase
      .from("schedule_sources")
      .update({ status: "error", last_error: message, updated_at: now.toISOString() })
      .eq("id", input.source.id);

    return { imported: 0, updated: 0, cancelled: 0, vendor: vendorId, ok: false, error: message };
  }

  try {
    const result = await connector.sync({
      sourceId: input.source.id,
      orgId: input.source.org_id,
      url: input.source.source_url,
      window: input.window,
      // Pass through for Google Calendar connector (ignored by others)
      userId: input.source.connected_user_id ?? undefined,
      supabase,
    });

    await supabase
      .from("schedule_sources")
      .update({
        status: "active",
        last_synced_at: now.toISOString(),
        last_error: null,
        last_event_count: result.imported + result.updated,
        last_imported: result.imported,
        last_updated: result.updated,
        last_cancelled: result.cancelled,
        updated_at: now.toISOString(),
      })
      .eq("id", input.source.id);

    debugLog("schedule-sync", "source synced", {
      sourceId: input.source.id,
      vendor: vendorId,
      url: input.source.source_url.slice(0, 80),
      imported: result.imported,
      updated: result.updated,
      cancelled: result.cancelled,
    });

    return { ...result, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync schedule source.";
    await supabase
      .from("schedule_sources")
      .update({ status: "error", last_error: message, updated_at: now.toISOString() })
      .eq("id", input.source.id);

    return { imported: 0, updated: 0, cancelled: 0, vendor: vendorId, ok: false, error: message };
  }
}
