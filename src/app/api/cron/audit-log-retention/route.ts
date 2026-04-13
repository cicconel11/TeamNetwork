import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateCronAuth } from "@/lib/security/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Daily cron job to purge expired audit log entries.
 *
 * Calls retention functions:
 *   - purge_old_enterprise_audit_logs() — existing function
 *   - purge_old_data_access_logs() — created in Phase 3 migration
 */
export async function GET(request: Request) {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = createServiceClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: enterpriseData, error: enterpriseError } = await (supabase.rpc as any)("purge_old_enterprise_audit_logs");
    if (enterpriseError && enterpriseError.code !== "42883") {
      throw enterpriseError;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: accessData, error: accessError } = await (supabase.rpc as any)("purge_old_data_access_logs");
    if (accessError && accessError.code !== "42883") {
      throw accessError;
    }

    return NextResponse.json({
      success: true,
      enterpriseAuditPurged: enterpriseData ?? null,
      dataAccessPurged: accessData ?? null,
    });
  } catch (err) {
    console.error("[cron/audit-log-retention] Error:", err);
    return NextResponse.json(
      { error: "Failed to purge audit logs" },
      { status: 500 },
    );
  }
}
