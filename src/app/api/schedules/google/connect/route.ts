import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncScheduleSource } from "@/lib/schedule-connectors/sync-source";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import { validateJson, ValidationError, validationErrorResponse } from "@/lib/security/validation";
import { googleCalendarConnectSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 366;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in." },
        { status: 401 }
      );
    }

    const body = await validateJson(request, googleCalendarConnectSchema);

    // Check admin role
    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", body.orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can connect schedule sources." },
        { status: 403 }
      );
    }

    // Block mutations if org is in grace period
    const { isReadOnly } = await checkOrgReadOnly(body.orgId);
    if (isReadOnly) {
      return NextResponse.json(readOnlyResponse(), { status: 403 });
    }

    // Verify user has a connected Google account
    const serviceClient = createServiceClient();
    const { data: connection } = await serviceClient
      .from("user_calendar_connections")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .maybeSingle();

    if (!connection) {
      return NextResponse.json(
        { error: "Not connected", message: "No Google account connected. Please connect your Google account first." },
        { status: 400 }
      );
    }

    const sourceUrl = `google://${body.googleCalendarId}`;

    // Create schedule source
    const { data: source, error: insertError } = await supabase
      .from("schedule_sources")
      .insert({
        org_id: body.orgId,
        created_by: user.id,
        vendor_id: "google_calendar",
        source_url: sourceUrl,
        title: body.title ?? null,
        connected_user_id: user.id,
        google_calendar_id: body.googleCalendarId,
      })
      .select("id, org_id, vendor_id, source_url, status, last_synced_at, last_error, title, connected_user_id")
      .single();

    if (insertError || !source) {
      if (insertError?.code === "23505") {
        return NextResponse.json(
          { error: "Already connected", message: "This Google Calendar is already connected as a schedule source." },
          { status: 409 }
        );
      }
      console.error("[schedules/google/connect] Failed to create source:", insertError);
      return NextResponse.json(
        { error: "Database error", message: "Failed to create schedule source." },
        { status: 500 }
      );
    }

    // Trigger initial sync
    const window = buildSyncWindow();
    const syncResult = await syncScheduleSource(serviceClient, {
      source: {
        id: source.id,
        org_id: source.org_id,
        vendor_id: source.vendor_id,
        source_url: source.source_url,
        connected_user_id: source.connected_user_id,
      },
      window,
    });

    // Re-fetch source to get post-sync state
    const { data: freshSource } = await supabase
      .from("schedule_sources")
      .select("id, org_id, vendor_id, status, last_synced_at, last_error, title")
      .eq("id", source.id)
      .single();

    const s = freshSource ?? source;

    return NextResponse.json({
      source: {
        id: s.id,
        vendor_id: s.vendor_id,
        status: s.status,
        last_synced_at: s.last_synced_at,
        last_error: s.last_error,
        title: s.title,
      },
      sync: syncResult,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return validationErrorResponse(error);
    }

    console.error("[schedules/google/connect] Error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to connect Google Calendar." },
      { status: 500 }
    );
  }
}

function buildSyncWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - WINDOW_PAST_DAYS);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(to.getDate() + WINDOW_FUTURE_DAYS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}
