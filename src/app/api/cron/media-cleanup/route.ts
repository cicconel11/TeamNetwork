import { NextResponse } from "next/server";
import {
  isMissingMediaAlbumsDraftColumnError,
  isStaleEmptyUploadDraftAlbum,
} from "@/lib/media/gallery-upload-server";
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

    let cleanedUpUploads = 0;

    for (const upload of staleUploads || []) {
      if (upload.storage_path) {
        await supabase.storage.from(BUCKET).remove([upload.storage_path]);
      }

      // Mark as orphaned
      const { error: updateError } = await supabase
        .from("media_uploads")
        .update({
          status: "orphaned",
          deleted_at: new Date().toISOString(),
        })
        .eq("id", upload.id);

      if (!updateError) {
        cleanedUpUploads++;
      } else {
        console.error(`[cron/media-cleanup] Failed to mark ${upload.id} as orphaned:`, updateError);
      }
    }

    const { data: candidateDraftAlbums, error: draftQueryError } = await supabase
      .from("media_albums")
      .select("id, is_upload_draft, item_count, created_at, deleted_at")
      .eq("is_upload_draft", true)
      .eq("item_count", 0)
      .is("deleted_at", null)
      .lt("created_at", cutoff)
      .limit(BATCH_SIZE);

    if (draftQueryError) {
      if (isMissingMediaAlbumsDraftColumnError(draftQueryError)) {
        return NextResponse.json({
          success: true,
          cleanedUp: cleanedUpUploads,
          cleanedUpUploads,
          cleanedUpDraftAlbums: 0,
        });
      }
      console.error("[cron/media-cleanup] Draft album query error:", draftQueryError);
      return NextResponse.json({ error: "Failed to query stale draft albums" }, { status: 500 });
    }

    let cleanedUpDraftAlbums = 0;

    for (const album of candidateDraftAlbums || []) {
      if (!isStaleEmptyUploadDraftAlbum(album, cutoff)) continue;

      const { error: deleteDraftError } = await supabase
        .from("media_albums")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("id", album.id);

      if (!deleteDraftError) {
        cleanedUpDraftAlbums++;
      } else {
        console.error(`[cron/media-cleanup] Failed to delete draft album ${album.id}:`, deleteDraftError);
      }
    }

    return NextResponse.json({
      success: true,
      cleanedUp: cleanedUpUploads + cleanedUpDraftAlbums,
      cleanedUpUploads,
      cleanedUpDraftAlbums,
    });
  } catch (err) {
    console.error("[cron/media-cleanup] Error:", err);
    return NextResponse.json({ error: "Failed to clean up media" }, { status: 500 });
  }
}
