import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job at 4 AM UTC to process pending account deletion requests.
 *
 * GDPR/COPPA Compliance: Executes scheduled user deletions after the 30-day
 * grace period. Users who requested deletion via DELETE /api/user/delete-account
 * are permanently removed here.
 *
 * Flow:
 * 1. Reset stale 'processing' rows (crash recovery)
 * 2. Atomically claim pending rows via RPC (FOR UPDATE SKIP LOCKED)
 * 3. For each claimed row:
 *    a. Capture email before deletion
 *    b. Delete user data (via RPC)
 *    c. Delete storage objects
 *    d. Delete auth user
 *    e. Write audit record
 *    f. Send confirmation email
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const serviceSupabase = createServiceClient();
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

  let processedCount = 0;
  let failedCount = 0;

  try {
    // Step 1: Stale recovery — reset rows stuck in 'processing' for > 2 hours
    // (handles cron crashes mid-run)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: staleError } = await (serviceSupabase as any)
      .from("user_deletion_requests")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("status", "processing")
      .lt("updated_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    if (staleError) {
      console.error("[cron/user-deletion] Stale recovery error:", staleError);
      // Non-fatal — proceed with the run
    }

    // Step 2: Claim pending deletions atomically
    // FOR UPDATE SKIP LOCKED in the RPC prevents concurrent cron workers from
    // double-processing the same row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: claimed, error: claimError } = await (serviceSupabase.rpc as any)(
      "claim_pending_deletions",
      { p_limit: 10 }
    ) as { data: Array<{ req_id: string; req_user_id: string }> | null; error: unknown };

    if (claimError) {
      console.error("[cron/user-deletion] Claim error:", claimError);
      return NextResponse.json(
        { error: "Failed to claim pending deletions" },
        { status: 500 }
      );
    }

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ success: true, processed: 0, failed: 0 });
    }

    // Step 3: Process each claimed row
    for (const { req_id, req_user_id } of claimed) {
      try {
        // Step 3a: Capture user email BEFORE deletion (for audit + confirmation email)
        const { data: { user: authUser } } = await serviceSupabase.auth.admin.getUserById(req_user_id);
        const userEmail = authUser?.email ?? null;

        // Step 3b: Delete user data via RPC (single transaction)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: cleanupResult, error: cleanupError } = await (serviceSupabase.rpc as any)(
          "delete_user_data",
          { p_user_id: req_user_id }
        ) as { data: Array<{ tables_affected: number; storage_paths: string[] }> | null; error: unknown };

        if (cleanupError) {
          throw new Error(`delete_user_data failed: ${String(cleanupError)}`);
        }

        const tablesAffected = cleanupResult?.[0]?.tables_affected ?? 0;
        const storagePaths = cleanupResult?.[0]?.storage_paths ?? [];

        // Step 3c: Delete storage objects
        let storageObjectsDeleted = 0;
        if (storagePaths.length > 0) {
          const { error: storageError } = await serviceSupabase.storage
            .from("user-uploads")
            .remove(storagePaths);

          if (storageError) {
            // Non-fatal: orphaned storage objects are acceptable; log and continue
            console.error(`[cron/user-deletion] Storage cleanup error for user ${req_user_id}:`, storageError);
          } else {
            storageObjectsDeleted = storagePaths.length;
          }
        }

        // Step 3d: Delete auth user (CASCADE/SET NULL from migration handles remaining FK refs)
        const { error: deleteAuthError } = await serviceSupabase.auth.admin.deleteUser(req_user_id);
        if (deleteAuthError) {
          throw new Error(`auth.admin.deleteUser failed: ${deleteAuthError.message}`);
        }

        // Step 3e: Mark as completed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (serviceSupabase as any)
          .from("user_deletion_requests")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", req_id);

        // Step 3f: Write audit record (after deletion — user_deletion_audit has no FK to auth.users)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: auditError } = await (serviceSupabase as any)
          .from("user_deletion_audit")
          .insert({
            user_id: req_user_id,
            user_email: userEmail,
            tables_affected: tablesAffected,
            storage_objects_deleted: storageObjectsDeleted,
          });

        if (auditError) {
          // Non-fatal: audit failure does NOT revert 'completed' status. The
          // deletion already happened. Log it and continue.
          console.error(`[cron/user-deletion] Audit write failed for user ${req_user_id}:`, auditError);
        }

        // Step 3g: Send confirmation email
        if (resend && userEmail) {
          const confirmationError = await resend.emails.send({
            from: FROM_EMAIL,
            to: userEmail,
            subject: "Your TeamNetwork Account Has Been Deleted",
            text: `Hello,

Your TeamNetwork account and all associated data have been permanently deleted as requested.

If you did not request this deletion or have questions, please contact us at support@myteamnetwork.com.

Thank you for using TeamNetwork.`.trim(),
          }).then(() => null).catch((err: unknown) => err);

          if (confirmationError) {
            // Non-fatal: email failure does NOT revert 'completed' status.
            console.error(`[cron/user-deletion] Confirmation email failed for ${req_user_id}:`, confirmationError);
          }
        }

        processedCount++;
      } catch (err) {
        // Non-fatal per-row error: mark as failed and continue to next row
        failedCount++;
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[cron/user-deletion] Failed to delete user ${req_user_id}:`, reason);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (serviceSupabase as any)
          .from("user_deletion_requests")
          .update({
            status: "failed",
            failed_reason: reason.slice(0, 500), // truncate to prevent oversized DB values
            updated_at: new Date().toISOString(),
          })
          .eq("id", req_id);
      }
    }

    return NextResponse.json({ success: true, processed: processedCount, failed: failedCount });
  } catch (err) {
    console.error("[cron/user-deletion] Unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected error in user deletion cron" },
      { status: 500 }
    );
  }
}
