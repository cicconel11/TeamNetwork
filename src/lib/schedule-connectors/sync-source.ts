import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getConnectorById } from "./registry";
import type { SyncResult, VendorId } from "./types";

export type SyncOutcome = SyncResult & { ok: boolean; error?: string };

export async function syncScheduleSource(
  supabase: SupabaseClient<Database>,
  input: {
    source: {
      id: string;
      org_id: string;
      vendor_id: string;
      source_url: string;
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
    });

    await supabase
      .from("schedule_sources")
      .update({
        status: "active",
        last_synced_at: now.toISOString(),
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", input.source.id);

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
