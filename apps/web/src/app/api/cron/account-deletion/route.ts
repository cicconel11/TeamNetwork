import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH_LIMIT = 50;

/**
 * Daily cron job to process pending account deletion requests.
 *
 * Picks up rows from user_deletion_requests where:
 *   - status = 'pending'
 *   - scheduled_deletion_at <= now()  (30-day grace period elapsed)
 *
 * For each, calls auth.admin.deleteUser() which cascades through
 * the FK graph (Phase 0 migration ensures no RESTRICT violations).
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: requests, error: fetchError } = await (supabase as any)
      .from("user_deletion_requests")
      .select("id, user_id")
      .eq("status", "pending")
      .lte("scheduled_deletion_at", new Date().toISOString())
      .limit(BATCH_LIMIT);

    if (fetchError) {
      if (fetchError.code === "42P01") {
        // Table doesn't exist yet — nothing to do
        return NextResponse.json({ success: true, processed: 0, note: "table not found" });
      }
      throw fetchError;
    }

    if (!requests || requests.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    let succeeded = 0;
    let failed = 0;

    for (const req of requests as Array<{ id: string; user_id: string }>) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(req.user_id);

        if (deleteError) {
          // user_not_found means already deleted — mark as completed
          const isAlreadyGone =
            deleteError.message?.includes("not found") ||
            deleteError.message?.includes("User not found");

          if (!isAlreadyGone) {
            console.error("[cron/account-deletion] Failed to delete user:", req.user_id, deleteError.message);
            failed++;
            continue;
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase as any)
          .from("user_deletion_requests")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", req.id);

        if (updateError) {
          console.error("[cron/account-deletion] Failed to update request status:", req.id, updateError.message);
          failed++;
          continue;
        }

        succeeded++;
      } catch (err) {
        console.error("[cron/account-deletion] Error processing request:", req.id, err);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      processed: requests.length,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error("[cron/account-deletion] Error:", err);
    return NextResponse.json(
      { error: "Failed to process account deletions" },
      { status: 500 },
    );
  }
}
