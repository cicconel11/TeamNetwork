import { NextResponse } from "next/server";
import {
  checkRateLimit,
  buildRateLimitResponse,
} from "@/lib/security/rate-limit";
import {
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { reportContentSchema } from "@/lib/schemas/moderation";
import { sendNewReportEmail } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  let respond:
    | ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>)
    | null = null;

  try {
    const { createAuthenticatedApiClient } = await import("@/lib/supabase/api");
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { supabase, user } = await createAuthenticatedApiClient(request);
    const serviceSupabase = createServiceClient();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "content report",
      limitPerIp: 20,
      limitPerUser: 10,
      windowMs: HOUR_MS,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await validateJson(request, reportContentSchema, {
      maxBodyBytes: 4_000,
    });

    // Verify reporter is active member of the org.
    const { data: membership, error: membershipError } = await supabase
      .from("user_organization_roles")
      .select("role, status")
      .eq("user_id", user.id)
      .eq("organization_id", body.organization_id)
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      console.error("[moderation/report] membership lookup failed", membershipError);
      return respond({ error: "Unable to verify membership" }, 500);
    }
    if (!membership) {
      return respond({ error: "Not a member of this organization" }, 403);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reportsTable = (serviceSupabase as any).from("content_reports");
    const { data: insertedRows, error: insertError } = await reportsTable
      .insert({
        organization_id: body.organization_id,
        reporter_id: user.id,
        target_type: body.target_type,
        target_id: body.target_id,
        reported_user_id: body.reported_user_id ?? null,
        reason: body.reason,
        details: body.details ?? null,
      })
      .select("id, target_type, reason, details")
      .single() as {
        data: {
          id: string;
          target_type: typeof body.target_type;
          reason: typeof body.reason;
          details: string | null;
        } | null;
        error: { message: string; code?: string } | null;
      };

    if (insertError || !insertedRows) {
      console.error("[moderation/report] insert failed", insertError);
      return respond({ error: "Failed to file report" }, 500);
    }

    // Best-effort admin email — never blocks the user response.
    const { data: reporterProfile } = await supabase
      .from("users")
      .select("name")
      .eq("id", user.id)
      .maybeSingle();

    const reporterFirstName =
      reporterProfile?.name?.trim().split(/\s+/)[0] ?? null;

    void sendNewReportEmail({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: serviceSupabase as any,
      organizationId: body.organization_id,
      report: insertedRows,
      reporterFirstName,
    });

    return respond({ id: insertedRows.id }, 201);
  } catch (err) {
    if (err instanceof ValidationError) {
      if (respond) {
        return respond({ error: err.message, details: err.details }, 400);
      }
      return validationErrorResponse(err);
    }
    console.error("[moderation/report] unexpected error", err);
    return NextResponse.json({ error: "Failed to file report" }, { status: 500 });
  }
}
