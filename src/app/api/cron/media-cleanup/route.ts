import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "org-media";
const BATCH_SIZE = 100;
const STALE_HOURS = 24;

/**
 * Daily cron job to clean up orphaned media uploads.
 * Deletes storage files and marks rows as orphaned for pending uploads older than 24 hours.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();
    const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

    // Fetch stale pending uploads
    const { data: staleUploads, error: queryError } = await supabase
      .from("media_uploads")
      .select("id, storage_path")
      .eq("status", "pending")
      .is("deleted_at", null)
      .lt("created_at", cutoff)
      .limit(BATCH_SIZE);

    if (queryError) {
      console.error("[cron/media-cleanup] Query error:", queryError);
      return NextResponse.json({ error: "Failed to query stale uploads" }, { status: 500 });
    }

    if (!staleUploads || staleUploads.length === 0) {
      return NextResponse.json({ success: true, cleanedUp: 0 });
    }

    let cleanedUp = 0;

    for (const upload of staleUploads) {
      // Delete file from storage (ignore errors for missing files)
      await supabase.storage.from(BUCKET).remove([upload.storage_path]);

      // Mark as orphaned
      const { error: updateError } = await supabase
        .from("media_uploads")
        .update({
          status: "orphaned",
          deleted_at: new Date().toISOString(),
        })
        .eq("id", upload.id);

      if (!updateError) {
        cleanedUp++;
      } else {
        console.error(`[cron/media-cleanup] Failed to mark ${upload.id} as orphaned:`, updateError);
      }
    }

    return NextResponse.json({ success: true, cleanedUp });
  } catch (err) {
    console.error("[cron/media-cleanup] Error:", err);
    return NextResponse.json({ error: "Failed to clean up media" }, { status: 500 });
  }
}
