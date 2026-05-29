import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";
import { deleteExpiredEnterprise } from "@/lib/enterprise/delete-enterprise";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BATCH_LIMIT = 50;

/**
 * Daily cron: purge enterprises whose 30-day soft-delete grace window has elapsed.
 *
 * Picks up enterprise_deletion_requests where status='pending' and
 * scheduled_deletion_at <= now(). For each, deleteExpiredEnterprise cancels
 * Stripe then hard-deletes the enterprise row — which CASCADE-deletes the
 * request row itself. A Stripe-cancel failure halts that one row (stays
 * pending, retried next run) without blocking the others.
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: requests, error: fetchError } = await (supabase as any)
      .from("enterprise_deletion_requests")
      .select("id, enterprise_id")
      .eq("status", "pending")
      .lte("scheduled_deletion_at", new Date().toISOString())
      .limit(BATCH_LIMIT);

    if (fetchError) {
      if (fetchError.code === "42P01") {
        return NextResponse.json({ success: true, processed: 0, note: "table not found" });
      }
      throw fetchError;
    }

    if (!requests || requests.length === 0) {
      return NextResponse.json({ success: true, processed: 0, succeeded: 0, failed: 0 });
    }

    let succeeded = 0;
    let failed = 0;

    for (const req of requests as Array<{ id: string; enterprise_id: string }>) {
      const result = await deleteExpiredEnterprise(req.enterprise_id);
      if (result.success) {
        // The request row cascade-deletes with the enterprise; nothing to update.
        succeeded++;
      } else {
        console.error(
          "[cron/enterprise-deletion] Failed to purge enterprise:",
          req.enterprise_id,
          result.error
        );
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
    console.error("[cron/enterprise-deletion] Error:", err);
    return NextResponse.json({ error: "Failed to process enterprise deletions" }, { status: 500 });
  }
}
